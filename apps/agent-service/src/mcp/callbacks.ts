import { errorMessage } from '@ai/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logging.js';

/**
 * Host callbacks for the control session (D6). Auth URLs, watcher intents
 * and MCP Apps messages become service events for desktop/CLI; they NEVER
 * trigger the control session model loop. `triggerTurn` deliveries are
 * captured and converted, never forwarded. Full URLs ride the authenticated
 * event channel only; logs carry a redacted form.
 */

export interface HostCallbackScope {
  taskId: string;
  runId: string | null;
  executionId: string;
}

const SERVICE_SCOPE: HostCallbackScope = { taskId: 'mcp', runId: null, executionId: 'service:mcp' };

export interface HostCallbackCounters {
  authUrls: number;
  triggerCaptured: number;
  triggerForwarded: number;
  browserSpawns: number;
  forwardedDisplay: number;
}

export class McpHostCallbacks {
  private readonly counters: HostCallbackCounters = {
    authUrls: 0,
    triggerCaptured: 0,
    triggerForwarded: 0,
    browserSpawns: 0,
    forwardedDisplay: 0,
  };

  constructor(
    private readonly events: EventLog,
    private readonly log: Logger,
  ) {}

  snapshot(): HostCallbackCounters {
    return { ...this.counters };
  }

  /** Adapter openBrowser seam: publish the URL, never spawn a browser. */
  async openBrowser(url: string): Promise<void> {
    this.counters.authUrls += 1;
    this.log.info('MCP authentication URL is ready.', { url: redactUrl(url) });
    this.publishNotice(`MCP sign-in is ready. Open the link from MCP settings to continue.`, {
      type: 'auth_url',
      serverId: '',
      authorizationUrl: url,
    });
  }

  /** Server-scoped auth URL with the same no-browser guarantee. */
  authUrl(serverId: string, url: string): void {
    this.counters.authUrls += 1;
    this.log.info('MCP server authentication URL is ready.', { serverId, url: redactUrl(url) });
    this.publishNotice(`MCP sign-in for ${serverId} is ready. Open the link from MCP settings.`, {
      type: 'auth_url',
      serverId,
      authorizationUrl: url,
    });
  }

  /**
   * pi.sendMessage wrapper outcome. `triggerTurn` deliveries (OAuth watcher,
   * MCP Apps intents) become service events and are NEVER forwarded to the
   * session; plain display messages forward so adapter status stays intact.
   */
  sendMessageCapture(
    message: { customType?: unknown; content?: unknown; display?: unknown; details?: unknown },
    options: { triggerTurn?: boolean } | undefined,
    forward: () => void,
  ): void {
    if (options?.triggerTurn) {
      this.counters.triggerCaptured += 1;
      const customType = typeof message.customType === 'string' ? message.customType : 'mcp-intent';
      const details = (message.details ?? {}) as Record<string, unknown>;
      const server = typeof details['server'] === 'string' ? (details['server'] as string) : '';
      this.log.info('MCP intent captured as a service event (no model turn).', {
        customType,
        server,
      });
      this.publishNotice(`MCP ${server || 'server'} reported ${customType}.`, {
        type: 'watcher_intent',
        serverId: server,
        intent: customType,
      });
      return;
    }
    this.counters.forwardedDisplay += 1;
    try {
      forward();
    } catch (error) {
      this.log.warn('Control display forward failed.', { error: errorMessage(error) });
    }
  }

  /** pi.exec wrapper: browser-open spawns are refused and counted. */
  execGuard(argv: string[]): boolean {
    const target = argv.join(' ');
    if (
      /(^|\s)(open|xdg-open|start)( |$)/.test(target) ||
      /^https?:\/\//.test(argv[argv.length - 1] ?? '')
    ) {
      this.counters.browserSpawns += 1;
      this.log.warn('Browser spawn refused; the URL was published as a service event instead.', {
        argv: argv.slice(0, 2),
      });
      return false;
    }
    return true;
  }

  resourceUpdated(serverId: string, uri: string): void {
    this.log.info('MCP resource updated.', { serverId, uri: uri.slice(0, 512) });
    this.publishNotice(`MCP ${serverId} updated a subscribed resource.`, {
      type: 'resource_updated',
      serverId,
      uri: uri.slice(0, 512),
    });
  }

  listenState(serverId: string, state: string): void {
    this.log.debug('MCP listen state changed.', { serverId, state });
  }

  watcherError(serverId: string, error: unknown): void {
    this.log.warn('MCP background watcher failed without disturbing runs.', {
      serverId,
      error: errorMessage(error),
    });
  }

  private publishNotice(text: string, mcp: Record<string, unknown>): void {
    this.events.publish({
      ...SERVICE_SCOPE,
      type: 'notice',
      data: { text, kind: 'info', mcp },
    });
  }
}

/** Redacts query + hash for logs; the event channel carries the full URL. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}?<redacted>`;
  } catch {
    return '<invalid-url>';
  }
}

const VIEWER_KEY = 'MCP_UI_VIEWER';

/** Runs `fn` with the MCP UI viewer suppressed; restores the previous value. */
export async function withUiViewerNone<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env[VIEWER_KEY];
  process.env[VIEWER_KEY] = 'none';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[VIEWER_KEY];
    else process.env[VIEWER_KEY] = previous;
  }
}
