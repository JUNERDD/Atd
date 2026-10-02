import { errorMessage } from '@atd/agent-contracts';
import {
  McpConnectionClosedError,
  StdioTransport,
  type McpClient,
  type McpTransport,
  type ServerCapabilities,
  type Tool,
} from '@earendil-works/pi-mcp';
import type { Logger } from '../logging.js';
import { MCP_IDLE_CLOSE_MS } from './constants.js';
import type {
  McpCatalogCounter,
  McpCatalogCounts,
  McpCatalogRead,
  McpLiveConnection,
} from './types.js';

/**
 * One open client of the pool (mcp/pool.ts) as its callers see it: the server's capabilities, the
 * catalog counts and tool list kept current on `list_changed`, and `use`, which counts requests in
 * flight so an idle close never takes a busy connection. Which map it sits in and when it closes
 * are the pool's; this class only reports that its client closed.
 */

/** Which server and record state a connection serves. */
export interface ConnectionIdentity {
  serverId: string;
  /** The server id, or a per-task alias of an isolated one. */
  physical: string;
  /** `reuseKey(record)` of the record it was opened for. */
  reuseKey: string;
  /** True for base connections; a task alias never idle-closes. */
  idleClose: boolean;
  /**
   * Words `text` for a log line: wherever it quotes the URL the connection dials, the URL as
   * configured, since the filled-in one may hold secrets (launch-resolve.ts `withConfiguredUrl`).
   */
  hideUrl: (text: string) => string;
}

/** What a pooled connection needs from its pool. */
export interface ConnectionContext {
  counter: McpCatalogCounter;
  log: Logger;
  now(): number;
  /** The connection's counts were set: after its first count and after each recount. */
  counted(connection: PooledConnection): void;
  /** The client closed, whoever closed it. */
  closed(connection: PooledConnection): void;
  /** A retired connection finished its last request. */
  drained(connection: PooledConnection): void;
}

export class PooledConnection implements McpLiveConnection {
  readonly serverId: string;
  readonly physical: string;
  readonly reuseKey: string;
  readonly idleClose: boolean;
  readonly hideUrl: (text: string) => string;
  readonly capabilities: ServerCapabilities;
  readonly instructions: string | null;
  /** Set by the pool when it closes the connection itself, so the close is not a loss to report. */
  onPurpose = false;
  private known: McpCatalogCounts = { tools: 0, resources: 0, prompts: 0 };
  private listed: Tool[] = [];
  private open = true;
  private retired = false;
  private inflight = 0;
  private lastUsedAt: number;
  private recounting = false;
  private recountAgain = false;

  /**
   * Follows the client: `list_changed` rereads the catalog and a close is reported once. Server log
   * messages go to the service log from before the connect (pool.ts, server-log.ts).
   */
  constructor(
    identity: ConnectionIdentity,
    readonly client: McpClient,
    readonly transport: McpTransport,
    private readonly context: ConnectionContext,
  ) {
    this.serverId = identity.serverId;
    this.physical = identity.physical;
    this.reuseKey = identity.reuseKey;
    this.idleClose = identity.idleClose;
    this.hideUrl = identity.hideUrl;
    // initialize validated the result, so a connected client always has its capabilities.
    const capabilities = client.serverCapabilities;
    if (!capabilities) throw new McpConnectionClosedError('MCP client has not initialized');
    this.capabilities = capabilities;
    this.instructions = client.instructions?.trim() || null;
    this.lastUsedAt = context.now();
    for (const family of ['tools', 'resources', 'prompts']) {
      client.onNotification(`notifications/${family}/list_changed`, () => this.recount());
    }
    client.onClose(() => {
      this.open = false;
      context.closed(this);
    });
  }

  counts(): McpCatalogCounts {
    return { ...this.known };
  }

  tools(): readonly Tool[] {
    return this.listed;
  }

  setCatalog(read: McpCatalogRead): void {
    this.known = read.counts;
    this.listed = read.tools;
    this.context.counted(this);
  }

  isOpen(): boolean {
    return this.open;
  }

  touch(): void {
    this.lastUsedAt = this.context.now();
  }

  /** Nothing in flight for longer than `MCP_IDLE_CLOSE_MS` as of `now`. */
  idleSince(now: number): boolean {
    return this.open && this.inflight === 0 && now - this.lastUsedAt > MCP_IDLE_CLOSE_MS;
  }

  /** Marks it discarded; true when nothing is in flight, so the pool can close it now. */
  retire(): boolean {
    this.retired = true;
    return this.inflight === 0;
  }

  async use<T>(request: (client: McpClient) => Promise<T>): Promise<T> {
    this.inflight += 1;
    this.touch();
    try {
      return await request(this.client);
    } finally {
      this.inflight -= 1;
      this.touch();
      if (this.retired && this.inflight === 0) this.context.drained(this);
    }
  }

  /** One recount at a time; a `list_changed` that arrives meanwhile earns one more. */
  private recount(): void {
    if (this.recounting) {
      this.recountAgain = true;
      return;
    }
    this.recounting = true;
    void (async () => {
      do {
        this.recountAgain = false;
        try {
          this.setCatalog(await this.context.counter(this.client, undefined));
        } catch (error) {
          this.context.log.debug('MCP catalog recount failed.', {
            serverId: this.serverId,
            physical: this.physical,
            error: this.hideUrl(errorMessage(error)),
          });
        }
      } while (this.recountAgain && this.open);
      this.recounting = false;
    })();
  }
}

/** The last `chars` characters a stdio child wrote to stderr; empty for any other transport. */
export function stderrTail(transport: McpTransport | undefined, chars: number): string {
  return transport instanceof StdioTransport ? transport.stderr.trim().slice(-chars) : '';
}

/** How much of a stdio child's stderr a failed connect's message carries. */
const CONNECT_STDERR_CHARS = 1000;

/** A stdio child that died while connecting says why on stderr; the message carries the tail. */
export function withStderr(error: unknown, transport: McpTransport | undefined): unknown {
  const tail = stderrTail(transport, CONNECT_STDERR_CHARS);
  if (!tail) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${message}\n${tail}`, { cause: error });
}
