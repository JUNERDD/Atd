import http from 'node:http';
import https from 'node:https';
import { Agent as RoutingAgent, type AgentConnectOpts } from 'agent-base';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Dispatcher, Pool as UndiciPool } from 'undici';
import type { Logger } from '../logging.js';
import {
  readSystemProxySettings,
  systemProxyResolver,
  type SystemProxyResolver,
} from './system-proxy-settings.js';

const ENVIRONMENT_KEY = 'AI_AGENT_SYSTEM_PROXY';
const EXPLICIT_PROXY_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
];

/** Called once before service startup; proxy changes take effect on the next native launch. */
export async function applySystemProxy(log: Logger): Promise<void> {
  const raw = process.env[ENVIRONMENT_KEY];
  // This is a shell-to-service launch contract, not configuration for child tools/MCP servers.
  delete process.env[ENVIRONMENT_KEY];
  if (!raw) return;
  if (
    process.env.NODE_USE_ENV_PROXY === '0' ||
    EXPLICIT_PROXY_KEYS.some((key) => Boolean(process.env[key]?.trim()))
  ) {
    log.info('System proxy inheritance skipped because an explicit proxy environment is set.');
    return;
  }
  try {
    const settings = readSystemProxySettings(raw);
    if (!settings.http && !settings.https) return;
    const { resolve, skipped } = systemProxyResolver(settings);
    // Importing Undici can initialize its global dispatcher. Leave it untouched without a snapshot.
    // The shared dispatcher covers global fetch, OAuth discovery/token exchange and model SDKs.
    const undici = await import('undici');
    undici.setGlobalDispatcher(systemProxyDispatcher(undici, resolve));
    const agent = new SystemProxyAgent(resolve);
    http.globalAgent = agent;
    https.globalAgent = agent;
    log.info('Using the macOS system HTTP proxy snapshot.', {
      http: Boolean(settings.http),
      https: Boolean(settings.https),
      exceptions: settings.exceptions.length,
      skippedExceptions: skipped,
    });
  } catch {
    // Invalid local settings must not prevent the service or its local control channel starting.
    log.warn('Could not apply the macOS system proxy snapshot; inherited networking is unchanged.');
  }
}

/**
 * Route each request by the system rules through long-lived library agents, so undici's
 * idle-origin eviction covers proxied origins as it does direct ones. Library agents own CONNECT,
 * TLS validation, streaming and cancellation.
 */
function systemProxyDispatcher(undici: typeof import('undici'), resolve: SystemProxyResolver) {
  const { Agent, Pool, ProxyAgent, buildConnector } = undici;
  const direct = new Agent();
  const routes = new Map<string, Dispatcher>();
  // ProxyAgent (undici 8.10.2) keeps a forwarding wrapper per plain-HTTP origin and never evicts
  // it. Per-origin pools whose sockets reach the proxy are evicted when idle like direct ones.
  const forwardingAgent = (proxy: string) => {
    const { hostname, port } = new URL(proxy);
    const host = hostname.replace(/^\[(.*)\]$/, '$1');
    const connector = buildConnector({});
    return new Agent({
      factory: (origin, options: UndiciPool.Options) =>
        new Pool(origin, {
          ...options,
          connect: (target, callback) => connector({ ...target, hostname: host, port }, callback),
        }),
    });
  };
  const route = (protocol: string, proxy: string): Dispatcher => {
    const key = `${protocol}${proxy}`;
    let agent = routes.get(key);
    if (!agent) {
      agent = protocol === 'https:' ? new ProxyAgent(proxy) : forwardingAgent(proxy);
      routes.set(key, agent);
    }
    return agent;
  };
  const all = () => [direct, ...routes.values()];

  class SystemProxyDispatcher extends undici.Dispatcher {
    override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
      const { protocol, hostname, origin } = new URL(String(options.origin));
      const proxy = resolve(protocol, hostname);
      if (!proxy) return direct.dispatch(options, handler);
      if (protocol === 'https:') return route(protocol, proxy).dispatch(options, handler);
      // A forward proxy takes the absolute-form target; Host stays the origin's (RFC 9112 3.2.2).
      return route(protocol, proxy).dispatch({ ...options, path: origin + options.path }, handler);
    }

    override async close(callback?: () => void): Promise<void> {
      await Promise.all(all().map((agent) => agent.close()));
      callback?.();
    }

    override async destroy(
      error?: Error | null | (() => void),
      callback?: () => void,
    ): Promise<void> {
      if (typeof error === 'function') return this.destroy(null, error);
      await Promise.all(all().map((agent) => agent.destroy(error ?? null)));
      callback?.();
    }
  }
  return new SystemProxyDispatcher();
}

/** Route legacy HTTP/WebSocket callers through the same rules without implementing a tunnel. */
class SystemProxyAgent extends RoutingAgent {
  private readonly directHttp = new http.Agent({ keepAlive: true });
  private readonly directHttps = new https.Agent({ keepAlive: true });
  private readonly proxies = new Map<string, http.Agent>();
  private readonly resolve: SystemProxyResolver;

  constructor(resolve: SystemProxyResolver) {
    super();
    this.resolve = resolve;
  }

  connect(_request: http.ClientRequest, options: AgentConnectOpts): http.Agent {
    const protocol = options.secureEndpoint ? 'https:' : 'http:';
    const proxy = options.host ? this.resolve(protocol, options.host) : undefined;
    if (!proxy) return options.secureEndpoint ? this.directHttps : this.directHttp;
    const key = `${protocol}${proxy}`;
    let agent = this.proxies.get(key);
    if (!agent) {
      agent = options.secureEndpoint
        ? new HttpsProxyAgent(proxy, { keepAlive: true })
        : new HttpProxyAgent(proxy, { keepAlive: true });
      this.proxies.set(key, agent);
    }
    return agent;
  }

  override destroy(): void {
    this.directHttp.destroy();
    this.directHttps.destroy();
    for (const agent of this.proxies.values()) agent.destroy();
    super.destroy();
  }
}
