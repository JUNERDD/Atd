import type { McpAuthUrlNotice } from '@atd/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logging.js';

/**
 * What MCP management tells the desktop and CLI through the authenticated event channel. The
 * service never opens a browser: a sign-in URL is published as a notice and the client opens it.
 * The full URL rides the event channel only; logs carry a redacted form. Sign-in completion has
 * no notice of its own; it shows through the connection states.
 */

const SERVICE_SCOPE = { taskId: 'mcp', runId: null, executionId: 'service:mcp' } as const;

export class McpNotices {
  constructor(
    private readonly events: EventLog,
    private readonly log: Logger,
  ) {}

  /** A server's sign-in URL is ready; the notice carries it for the client to open. */
  authUrl(serverId: string, url: string): void {
    this.log.info('MCP server authentication URL is ready.', { serverId, url: redactUrl(url) });
    const notice: McpAuthUrlNotice = {
      text: `MCP sign-in for ${serverId} is ready. Open the link from MCP settings.`,
      kind: 'info',
      mcp: { type: 'auth_url', serverId, authorizationUrl: url },
    };
    this.events.publish({ ...SERVICE_SCOPE, type: 'notice', data: notice });
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
