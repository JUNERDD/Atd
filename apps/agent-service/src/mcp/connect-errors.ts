import { BlockList, isIP } from 'node:net';
import type { McpServerConfig } from '@ai/agent-contracts';
import {
  causeChain,
  causesOf,
  isUnauthorized,
  MAX_CAUSE_DEPTH,
  McpError,
  type McpStateSink,
} from './errors.js';
import { resolveHttpUrl, withConfiguredUrl } from './launch-resolve.js';
import { TxnRevoked } from './transactions.js';

/**
 * How a failed connect reads and what it leaves behind: the state of the server's row and the
 * error its caller gets. Only messages and codes are quoted, never the request that failed.
 */

/** A status row's `lastError` holds at most this many characters. */
const LAST_ERROR_CHARS = 2000;

/** A name that resolves to many addresses fails with one error each; the first few say enough. */
const MAX_MEMBERS = 4;

/**
 * A connect that a revoke, a disable or a removal overtook (HTTP 409). Whoever changed the server
 * settles its row and closes its connections, so this error leaves the row alone, except that a
 * row the connect left `connecting` returns to `disconnected` (see `translateConnectError`).
 */
export class ConnectOvertaken extends McpError {
  constructor(serverId: string) {
    super('conflict', serverId, `MCP server ${serverId} changed while it was connecting.`);
  }
}

/** Moves the row of `record`'s server to what `error` means and returns the error to throw. */
export function translateConnectError(
  states: McpStateSink,
  record: McpServerConfig,
  error: unknown,
  signal?: AbortSignal,
): McpError | Error {
  const { serverId } = record;
  // Overtaken, whether the transaction refused the connect (`TxnRevoked`, queued or running) or the
  // connect noticed itself: the change owns the row now, whatever the caller did, so this is
  // checked before the caller's abort. Only the `connecting` this connect left is put back: a
  // change whose commit fails never settles the row, and any other state is the change's.
  const overtaken = error instanceof TxnRevoked ? new ConnectOvertaken(serverId) : error;
  if (overtaken instanceof ConnectOvertaken) {
    if (states.get(serverId) === 'connecting') states.set(serverId, 'disconnected', '');
    return overtaken;
  }
  // A credential the app does not hold: the row says why and can be retried once it is saved.
  if (error instanceof McpError && error.code === 'auth_required') {
    states.set(serverId, 'error', error.message);
    return error;
  }
  // The launch gate's refusals keep their codes: not approved (yet), or never launchable.
  if (error instanceof McpError && error.code === 'approval_required') {
    states.set(serverId, 'approval_required', error.message);
    return error;
  }
  if (error instanceof McpError && error.code === 'forbidden') {
    states.set(serverId, 'error', error.message);
    return error;
  }
  if (signal?.aborted) {
    states.set(serverId, 'disconnected', '');
    return asError(error);
  }
  // A disconnect that cancelled this connect owns the state it is about to settle.
  if (states.get(serverId) === 'closing') return asError(error);
  if (isUnauthorized(error)) {
    states.set(serverId, 'auth_required', '');
    return new McpError('auth_required', serverId, `MCP server ${serverId} needs authentication.`);
  }
  // The launch could not be resolved (an unset URL variable, a missing cwd): already worded.
  if (error instanceof McpError) {
    states.set(serverId, 'error', error.message);
    return error;
  }
  // A library error may quote the URL it was given, whose variables may hold secrets.
  const diagnosis = diagnoseConnectError(record, error, dialedUrl(record), process.platform);
  const detail = clip(withConfiguredUrl(diagnosis, record), LAST_ERROR_CHARS);
  states.set(serverId, 'error', detail);
  return new McpError('internal', serverId, detail);
}

/** The URL an HTTP record dials, its variables filled in; undefined for any other record. */
function dialedUrl(record: McpServerConfig): string | undefined {
  if (!record.http) return undefined;
  try {
    return resolveHttpUrl(record);
  } catch {
    return undefined;
  }
}

/**
 * What a failed connect of `record` says. `url` is the URL an HTTP record dialed, filled in;
 * `platform` selects the macOS hint.
 */
export function diagnoseConnectError(
  record: McpServerConfig,
  error: unknown,
  url: string | undefined,
  platform: NodeJS.Platform,
): string {
  const message = messageWithCauses(error) || String(error);
  if (record.stdio && /ENOENT|not found|no such file/i.test(message)) {
    return `MCP server ${record.serverId} failed to start (${record.stdio.command}): ${message}. Bundle the runtime with the service; there is no hidden global fallback.`;
  }
  // The hint ends its own sentence.
  const hint = localNetworkHint(error, url, platform);
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i.test(message)) {
    return `MCP server ${record.serverId} is unreachable: ${message}${hint || '.'}`;
  }
  return `MCP server ${record.serverId} failed to connect: ${message}${hint}`;
}

/**
 * macOS asks before an app reaches the local network, and fails one that was refused with a routing
 * error. These are the errnos, addresses and wording pi-mcp-adapter 3.1.0 gave such a failure
 * (`server-manager.ts` `enrichHttpConnectionError`), except that the host is named for this app.
 */
const LOCAL_NETWORK_CODES: ReadonlySet<string> = new Set(['EHOSTUNREACH', 'ENETUNREACH', 'EACCES']);

const LOCAL_NETWORK_HINT =
  'macOS Local Network Privacy may be blocking access. Check System Settings > Privacy & Security > Local Network for the app hosting this service; enable access if listed and restart it. Try launching it from Terminal.app or SSH. Routing or firewall problems can also cause this error.';

const LOCAL_ADDRESSES = new BlockList();
LOCAL_ADDRESSES.addSubnet('10.0.0.0', 8);
LOCAL_ADDRESSES.addSubnet('172.16.0.0', 12);
LOCAL_ADDRESSES.addSubnet('192.168.0.0', 16);
LOCAL_ADDRESSES.addSubnet('169.254.0.0', 16);
LOCAL_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');
LOCAL_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');

/** True when the host of `url` is a private or link-local address written out; a name is not. */
function isLiteralLocalAddress(url: string): boolean {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  return family !== 0 && LOCAL_ADDRESSES.check(host, family === 6 ? 'ipv6' : 'ipv4');
}

/**
 * What to append to the message of a failed connect to `url` (the URL filled in): on macOS, when an
 * error of the chain carries a routing errno and the host is a private or link-local address, the
 * errnos and the hint. Empty otherwise.
 */
export function localNetworkHint(
  error: unknown,
  url: string | undefined,
  platform: NodeJS.Platform,
): string {
  if (platform !== 'darwin' || url === undefined || !isLiteralLocalAddress(url)) return '';
  const codes = new Set<string>();
  for (const link of causeChain(error)) {
    if ('code' in link && typeof link.code === 'string' && LOCAL_NETWORK_CODES.has(link.code)) {
      codes.add(link.code);
    }
  }
  return codes.size > 0 ? ` — ${[...codes].join(', ')} — ${LOCAL_NETWORK_HINT}` : '';
}

/**
 * What an error says, then what lies beneath it: `fetch failed` says nothing, its cause
 * (`connect ECONNREFUSED …`) does. The errors an AggregateError collects read as one list, and an
 * error without a message is named by its `code` unless something beneath it already says it.
 * Only messages and codes go in, never the request that failed. Empty when `error` is no Error.
 */
function messageWithCauses(error: unknown, depth = 0): string {
  if (!(error instanceof Error) || depth >= MAX_CAUSE_DEPTH) return '';
  const { cause, members } = causesOf(error);
  const listed = members
    .slice(0, MAX_MEMBERS)
    .map((member) => messageWithCauses(member, depth + 1));
  const beneath = [
    [...new Set(listed.filter(Boolean))].join(', '),
    messageWithCauses(cause, depth + 1),
  ];
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  const named = beneath.some((text) => text.includes(code)) ? '' : code;
  const parts: string[] = [];
  for (const text of [error.message || named, ...beneath]) {
    if (text && !parts.some((part) => part.includes(text))) parts.push(text);
  }
  return parts.join(': ');
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
