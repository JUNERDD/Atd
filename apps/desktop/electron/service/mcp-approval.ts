import { authHeaders, type AgentClientOptions } from '@ai/agent-client';
import {
  ErrorEnvelopeSchema,
  McpLaunchApprovalDetailsSchema,
  McpLaunchApproveResponseSchema,
  parse,
  type McpApprovalRequestResult,
  type McpLaunchApprovalDetails,
  type McpLaunchApproveRequest,
} from '@ai/agent-contracts';
import type { Confirm } from '../confirm-dialog';

/** How long a cancelled launch is refused without asking again, against a page that re-asks. */
export const CANCEL_COOLDOWN_MS = 30_000;

const BUTTONS = ['Cancel', 'Allow to Run'] as const;
const ALLOW = 1;

export interface McpApprovalDeps {
  /** Main's own service connection (its token never reaches a renderer); null while offline. */
  options: () => AgentClientOptions | null;
  /** Whether a native dialog or window operation already holds the panel. */
  dialogBusy: () => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** A refusal from the service, with its error code when the body was an error envelope. */
class ServiceRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Electron main's native confirmation of MCP launch approvals, the counterpart of the macOS
 * shell's. The renderer names a server and nothing else: main reads what would run from the
 * service's shell-only details route with its own token, shows it in a message box, and on Allow
 * approves with the fingerprint it showed, so a change in between is refused (409) rather than
 * approved unseen. One confirmation runs at a time; a Cancel refuses the same launch for
 * `CANCEL_COOLDOWN_MS` without another dialog.
 */
export class McpApprovalGate {
  private pending = false;
  /** The launch last cancelled per server, until when it is refused without a dialog. */
  private readonly cancelled = new Map<string, { fingerprint: string; until: number }>();

  constructor(private readonly deps: McpApprovalDeps) {}

  async request(serverId: string, confirm: Confirm): Promise<McpApprovalRequestResult> {
    if (this.pending || this.deps.dialogBusy()) return { approved: false, reason: 'busy' };
    const options = this.deps.options();
    if (!options) return { approved: false, reason: 'unavailable' };
    this.pending = true;
    try {
      return await this.confirmAndApprove(options, serverId, confirm);
    } finally {
      this.pending = false;
    }
  }

  private async confirmAndApprove(
    options: AgentClientOptions,
    serverId: string,
    confirm: Confirm,
  ): Promise<McpApprovalRequestResult> {
    const details = parse(
      McpLaunchApprovalDetailsSchema,
      await this.call(options, `/v1/admin/approvals/mcp/${encodeURIComponent(serverId)}`),
    );
    if (details.state === 'approved') return { approved: true };
    const now = this.deps.now ?? Date.now;
    const last = this.cancelled.get(serverId);
    if (last && last.fingerprint === details.fingerprint && last.until > now())
      return { approved: false, reason: 'cancelled' };
    // The details fetch awaited; another dialog may have opened meanwhile.
    if (this.deps.dialogBusy()) return { approved: false, reason: 'busy' };
    const response = await confirm({
      message: `Allow ${JSON.stringify(details.name)} to run?`,
      detail: describeLaunch(details),
      buttons: BUTTONS,
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== ALLOW) {
      this.cancelled.set(serverId, {
        fingerprint: details.fingerprint,
        until: now() + CANCEL_COOLDOWN_MS,
      });
      return { approved: false, reason: 'cancelled' };
    }
    this.cancelled.delete(serverId);
    const body: McpLaunchApproveRequest = {
      serverId: details.serverId,
      fingerprint: details.fingerprint,
      via: 'electron',
    };
    try {
      parse(
        McpLaunchApproveResponseSchema,
        await this.call(options, '/v1/admin/approvals/mcp', body),
      );
    } catch (error) {
      if (error instanceof ServiceRefusal && error.code === 'approval_changed')
        return { approved: false, reason: 'changed' };
      throw error;
    }
    return { approved: true };
  }

  private async call(
    options: AgentClientOptions,
    path: string,
    body?: McpLaunchApproveRequest,
  ): Promise<unknown> {
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const response = await fetchImpl(`${options.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...authHeaders(options),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json: unknown = await response.json().catch(() => null);
    if (response.ok) return json;
    let envelope: { code: string; message: string } | null = null;
    try {
      envelope = parse(ErrorEnvelopeSchema, json).error;
    } catch {
      // Not an error envelope: the status says enough.
    }
    throw new ServiceRefusal(
      response.status,
      envelope?.code ?? null,
      envelope?.message ?? `The service answered HTTP ${response.status}.`,
    );
  }
}

/**
 * What the dialog lists. Every value from a server's configuration is JSON-quoted, so line breaks
 * or look-alike text in it cannot pass for another line of the dialog. Env values stay hidden: the
 * service reports a stdio env key with its value's length, and for HTTP the names of the service
 * env vars the URL, headers and token send, with the URL and each header that reads one flagged.
 */
export function describeLaunch(details: McpLaunchApprovalDetails): string {
  const q = (value: string) => JSON.stringify(value);
  const lines = [
    details.kind === 'mcp-stdio'
      ? 'This server runs a command on this computer.'
      : 'This server sends values from the service environment to its URL.',
    ...(details.state === 'changed' ? ['It changed since you allowed it.'] : []),
    '',
    `Server: ${q(details.serverId)} (${details.layer === 'plugin' ? 'plugin' : 'your server'})`,
  ];
  if (details.plugin) {
    const { name, version, source, revision } = details.plugin;
    lines.push(`Plugin: ${q(name)}${version ? ` ${q(version)}` : ''}`, `Source: ${q(source)}`);
    lines.push(`Plugin revision: ${revision}`);
  }
  if (details.stdio) {
    const { command, resolvedCommand, args, cwd, inheritEnv, env } = details.stdio;
    lines.push(`Command: ${q(command)}`, `Runs: ${q(resolvedCommand)}`);
    lines.push(`Arguments: ${args.length ? JSON.stringify(args) : 'none'}`);
    lines.push(`Working directory: ${q(cwd)}`);
    lines.push(
      inheritEnv
        ? 'Environment: inherits the service environment'
        : env.length
          ? 'Environment: only the variables below'
          : 'Environment: none',
    );
    for (const entry of env)
      lines.push(
        `Env ${q(entry.key)}: ${entry.length} characters, hidden${entry.risky ? ' (changes what the runtime loads)' : ''}`,
      );
  }
  if (details.http) {
    const { url, urlReadsEnv, tokenEnv, headers, envReferences } = details.http;
    lines.push(`URL: ${q(url)}${urlReadsEnv ? ' (reads service env vars)' : ''}`);
    if (tokenEnv) lines.push(`Bearer token from service env var: ${q(tokenEnv)}`);
    for (const header of headers)
      lines.push(`Header ${q(header.key)}${header.readsEnv ? ': reads service env vars' : ''}`);
    // Every service value that leaves this computer, by name; the values stay hidden.
    const sent = [...(tokenEnv ? [tokenEnv] : []), ...envReferences];
    if (sent.length) lines.push(`Service env vars sent: ${JSON.stringify(sent)}`);
  }
  lines.push('', 'Allow it only if you trust where it came from.');
  return lines.join('\n');
}
