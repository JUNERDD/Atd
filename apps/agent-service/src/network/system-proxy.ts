import http from 'node:http';
import https from 'node:https';
import type { Dispatcher } from 'undici';
import type { Logger } from '../logging.js';
import { systemProxyDispatcher, SystemProxyAgent } from './system-proxy-routing.js';
import {
  readSystemProxySettings,
  systemProxyResolver,
  type SystemProxyResolver,
  type SystemProxySettings,
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

type ProxyRuntime = {
  undici: typeof import('undici');
  dispatcher: ReturnType<typeof systemProxyDispatcher>;
  agent: SystemProxyAgent;
  original: { dispatcher: Dispatcher; http: http.Agent; https: https.Agent };
};

export interface SystemProxyDiagnostics {
  mode: 'direct' | 'http' | 'env_override' | 'skipped_invalid';
  httpConfigured: boolean;
  httpsConfigured: boolean;
  exceptionsCount: number;
  skippedBypassCount: number;
}

/** Owns process-wide networking; native control frames replace the rules without replacing callers. */
export class SystemProxy {
  private readonly enabled: boolean;
  private runtime: ProxyRuntime | undefined;
  private resolve: SystemProxyResolver = () => undefined;
  private snapshot: string | undefined;
  private pending = Promise.resolve();
  private closed = false;
  private lastInvalid = false;
  private httpConfigured = false;
  private httpsConfigured = false;
  private exceptionsCount = 0;
  private skippedBypassCount = 0;

  constructor(private readonly log: Logger) {
    this.enabled =
      process.env.NODE_USE_ENV_PROXY !== '0' &&
      !EXPLICIT_PROXY_KEYS.some((key) => Boolean(process.env[key]?.trim()));
    if (!this.enabled)
      log.info('System proxy inheritance skipped because an explicit proxy environment is set.');
  }

  /** Readonly proxy summary without raw proxy hostnames or credentials. */
  diagnosticsStatus(): SystemProxyDiagnostics {
    const mode = !this.enabled
      ? 'env_override'
      : this.lastInvalid
        ? 'skipped_invalid'
        : this.httpConfigured || this.httpsConfigured
          ? 'http'
          : 'direct';
    return {
      mode,
      httpConfigured: this.httpConfigured,
      httpsConfigured: this.httpsConfigured,
      exceptionsCount: this.exceptionsCount,
      skippedBypassCount: this.skippedBypassCount,
    };
  }

  /** Records that an initial launch snapshot failed validation. */
  markInvalidSnapshot(): void {
    this.lastInvalid = true;
  }

  /** Validate before applying; serialize updates even while the first one loads Undici. */
  async update(raw: unknown): Promise<boolean> {
    let settings: SystemProxySettings;
    try {
      settings = readSystemProxySettings(raw);
    } catch (error) {
      this.lastInvalid = true;
      throw error;
    }
    const update = this.pending.then(async () => {
      if (!this.enabled || this.closed) return false;
      await this.apply(settings);
      return true;
    });
    // A rejected update is reported to its caller and must not poison subsequent valid updates.
    this.pending = update.then(
      () => undefined,
      () => undefined,
    );
    return update;
  }

  private async apply(settings: SystemProxySettings): Promise<void> {
    const snapshot = JSON.stringify(settings);
    if (snapshot === this.snapshot) return;
    const { resolve, skipped } = systemProxyResolver(settings);
    this.lastInvalid = false;
    this.httpConfigured = Boolean(settings.http);
    this.httpsConfigured = Boolean(settings.https);
    this.exceptionsCount = settings.exceptions.length;
    this.skippedBypassCount = skipped;
    if (!this.runtime) {
      // Install on the first native snapshot, even proxy-off, so clients that cache these
      // routing agents also follow a later proxy-on update. Headless hosts stay untouched.
      const undici = await import('undici');
      const original = {
        dispatcher: undici.getGlobalDispatcher(),
        http: http.globalAgent,
        https: https.globalAgent,
      };
      const resolver: SystemProxyResolver = (protocol, hostname) =>
        this.resolve(protocol, hostname);
      const dispatcher = systemProxyDispatcher(undici, resolver);
      const agent = new SystemProxyAgent(resolver);
      undici.setGlobalDispatcher(dispatcher);
      http.globalAgent = agent;
      https.globalAgent = agent;
      this.runtime = { undici, original, dispatcher, agent };
    }
    this.resolve = resolve;
    this.snapshot = snapshot;
    if (this.runtime) {
      const keys = new Set<string>();
      if (settings.http) keys.add(`http:${settings.http}`);
      if (settings.https) keys.add(`https:${settings.https}`);
      this.runtime.agent.retain(keys);
      void this.runtime.dispatcher.retain(keys).catch(() => {
        this.log.warn('A retired system proxy connection pool could not close gracefully.');
      });
    }
    this.log.info('Updated the macOS system HTTP proxy settings.', {
      http: Boolean(settings.http),
      https: Boolean(settings.https),
      exceptions: settings.exceptions.length,
      skippedExceptions: skipped,
    });
  }

  /** After service callers have stopped: restore inherited networking and release owned pools. */
  async close(): Promise<void> {
    this.closed = true;
    await this.pending;
    const runtime = this.runtime;
    if (!runtime) return;
    this.runtime = undefined;
    const { undici, original, dispatcher, agent } = runtime;
    if (undici.getGlobalDispatcher() === dispatcher)
      undici.setGlobalDispatcher(original.dispatcher);
    if (http.globalAgent === agent) http.globalAgent = original.http;
    if (https.globalAgent === agent) https.globalAgent = original.https;
    agent.destroy();
    await dispatcher.destroy();
  }
}

/** Seed from the shell's launch snapshot; its control stream supplies subsequent changes. */
export async function createSystemProxy(log: Logger): Promise<SystemProxy> {
  const raw = process.env[ENVIRONMENT_KEY];
  // This launch contract must not leak into child tools/MCP servers.
  delete process.env[ENVIRONMENT_KEY];
  const proxy = new SystemProxy(log);
  if (raw) {
    try {
      await proxy.update(JSON.parse(raw));
    } catch {
      proxy.markInvalidSnapshot();
      log.warn(
        'Could not apply the macOS system proxy snapshot; inherited networking is unchanged.',
      );
    }
  }
  return proxy;
}
