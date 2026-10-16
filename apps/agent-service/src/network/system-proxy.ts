import http from 'node:http';
import https from 'node:https';
import { Agent as RoutingAgent, type AgentConnectOpts } from 'agent-base';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Pool as UndiciPool } from 'undici';
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
    const resolve = systemProxyResolver(settings);
    // Importing Undici can initialize its global dispatcher. Leave it untouched without a snapshot.
    const { Agent, Pool, ProxyAgent, setGlobalDispatcher } = await import('undici');
    // The shared dispatcher covers global fetch, OAuth discovery/token exchange and model SDKs.
    // Library agents own CONNECT, TLS validation, streaming and cancellation.
    setGlobalDispatcher(
      new Agent({
        factory(origin, options: UndiciPool.Options) {
          const url = new URL(origin);
          const proxy = resolve(url.protocol, url.hostname);
          return proxy ? new ProxyAgent({ ...options, uri: proxy }) : new Pool(origin, options);
        },
      }),
    );
    const agent = new SystemProxyAgent(resolve);
    http.globalAgent = agent;
    https.globalAgent = agent;
    log.info('Using the macOS system HTTP proxy snapshot.', {
      http: Boolean(settings.http),
      https: Boolean(settings.https),
      exceptions: settings.exceptions.length,
    });
  } catch {
    // Invalid local settings must not prevent the service or its local control channel starting.
    log.warn('Could not apply the macOS system proxy snapshot; inherited networking is unchanged.');
  }
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
