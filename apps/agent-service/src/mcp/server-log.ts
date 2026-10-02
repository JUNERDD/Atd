import type { McpClient } from '@earendil-works/pi-mcp';
import type { Logger, LogLevel } from '../logging.js';

/**
 * Log messages a server sends with `notifications/message`, written to the service logger as pi
 * writes them to `mcp.log`: the server's level mapped onto the logger's, the logger name kept and
 * the data as text. The server decides what it sends, so each message is clipped and each
 * connection may write only so many per window; the first message over that budget says how the
 * rest of the window went.
 */

/** Characters of one message's text the log keeps. */
const MAX_MESSAGE_CHARS = 2000;
/** Messages one connection may log per window. */
const MAX_MESSAGES_PER_WINDOW = 60;
const WINDOW_MS = 60_000;

/** RFC 5424 levels MCP uses, as the service logger's levels. */
const LEVELS: Readonly<Record<string, LogLevel>> = {
  debug: 'debug',
  info: 'info',
  notice: 'info',
  warning: 'warn',
  error: 'error',
  critical: 'error',
  alert: 'error',
  emergency: 'error',
};

/** Who sent the messages, as the connection's log lines name it. */
export interface ServerLogSource {
  serverId: string;
  physical: string;
  /** Hides the dialed URL, which may hold secrets, wherever the text quotes it. */
  hideUrl: (text: string) => string;
}

export class McpServerLog {
  /**
   * Writes the client's log messages from now on. Attached before `connect`, so messages a server
   * sends while it initializes are logged too.
   */
  static attach(client: McpClient, log: Logger, source: ServerLogSource, now: () => number): void {
    const serverLog = new McpServerLog(log, source, now);
    client.onNotification('notifications/message', (params) => serverLog.write(params));
  }

  private windowStart = Number.NEGATIVE_INFINITY;
  private written = 0;
  private dropped = 0;

  constructor(
    private readonly log: Logger,
    private readonly source: ServerLogSource,
    private readonly now: () => number,
  ) {}

  /** Writes one `notifications/message` params object, unless the window's budget is spent. */
  write(params: unknown): void {
    const time = this.now();
    if (time - this.windowStart >= WINDOW_MS) {
      this.windowStart = time;
      this.written = 0;
      this.dropped = 0;
    }
    const fields = { serverId: this.source.serverId, physical: this.source.physical };
    if (this.written >= MAX_MESSAGES_PER_WINDOW) {
      this.dropped += 1;
      if (this.dropped === 1)
        this.log.warn('MCP server log messages are being dropped for the rest of the minute.', {
          ...fields,
          limit: MAX_MESSAGES_PER_WINDOW,
        });
      return;
    }
    this.written += 1;
    const message = isRecord(params) ? params : { data: params };
    const level = typeof message['level'] === 'string' ? message['level'] : 'info';
    const logger = typeof message['logger'] === 'string' ? message['logger'].slice(0, 100) : null;
    const text = this.source.hideUrl(formatData(message['data'])).slice(0, MAX_MESSAGE_CHARS);
    this.log[LEVELS[level] ?? 'info']('MCP server log message.', {
      ...fields,
      // Not `level`: the logger writes its own level under that key.
      serverLevel: level,
      ...(logger ? { logger } : {}),
      text,
    });
  }
}

function formatData(data: unknown): string {
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data) ?? String(data);
  } catch {
    return String(data);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
