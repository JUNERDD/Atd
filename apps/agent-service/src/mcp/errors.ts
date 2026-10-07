import type { ConfirmReview, McpConnectionState, McpServerConfig } from '@atd/agent-contracts';
import { McpAuthRequiredError, McpHttpError, McpSessionExpiredError } from '@earendil-works/pi-mcp';
import { McpOAuthAuthorizationRequiredError } from '@earendil-works/pi-mcp/oauth';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';

/**
 * Shared MCP operation context, boundary errors and seam interfaces. One
 * owner for the shapes the facade, connections, policy and lifecycle pass
 * between each other; no logic beyond error classification lives here.
 */

export interface OperationContext {
  operationId: string;
  taskId: string;
  runId: string;
  executionId: string;
  toolCallId?: string;
  /** Pinned config revision; mismatches fail instead of silently upgrading. */
  configRevision?: number;
  /**
   * The task tier's say on a call its server policy guards, asked before the per-operation
   * confirm. Runner proxies pass it; HTTP callers never do.
   */
  preapprove?: (signal?: AbortSignal) => Promise<McpPreapproval>;
  /**
   * Shows the operation's run as `awaiting_confirmation` while its per-operation confirm waits
   * and as `running` once it settles (approval.ts). Runner proxies pass it; HTTP callers never do.
   */
  setStatus?: (status: 'awaiting_confirmation' | 'running') => void;
}

/**
 * An allowed call runs without asking; a refused one may carry the review its confirm shows, or
 * say that its run is unattended (unattended.ts), where nobody answers a confirm and the approval
 * refuses the call at once (approval.ts).
 */
export type McpPreapproval =
  | { allowed: true }
  | { allowed: false; review?: ConfirmReview; unattended?: true };

export interface McpStateSink {
  set(serverId: string, state: McpConnectionState, lastError?: string): void;
  get(serverId: string): McpConnectionState;
}

export interface ServerResolver {
  record(serverId: string): McpServerConfig;
}

export interface SecretResolver {
  bearerToken(record: McpServerConfig): Promise<string | null>;
}

export interface McpProgress {
  kind: 'progress';
  progress: number;
  total?: number;
  message?: string;
}

export type McpUpdate = McpProgress;

export type McpErrorCode =
  | 'auth_required'
  /** The launch needs the user's approval (mcp/launch-approvals.ts); HTTP 403. */
  | 'approval_required'
  /** An approval named a fingerprint that no longer matches; HTTP 409. */
  | 'approval_changed'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'bad_request'
  | 'internal'
  | 'gone';

export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    readonly serverId: string,
    message: string,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

/** True when the error carries `status` or `code` equal to `expected` (an HTTP status). */
function reportsStatus(error: unknown, expected: number): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (
    ('status' in error && error.status === expected) || ('code' in error && error.code === expected)
  );
}

/**
 * The server wants credentials the request did not have: an HTTP 401 (pi-mcp's
 * `McpAuthRequiredError`, or anything else reporting that `status`) or an OAuth server whose
 * stored sign-in cannot be renewed without the user (`McpOAuthAuthorizationRequiredError`).
 */
export function isUnauthorized(error: unknown): boolean {
  if (error instanceof McpAuthRequiredError) return true;
  if (error instanceof McpOAuthAuthorizationRequiredError) return true;
  if (reportsStatus(error, 401)) return true;
  if (typeof error !== 'object' || error === null) return false;
  if ('name' in error && typeof error.name === 'string' && /unauthorized/i.test(error.name)) {
    return true;
  }
  const message = error instanceof Error ? error.message : '';
  return /needs-auth|requires authentication|unauthorized/i.test(message);
}

/** The server understood the credential and refused it: an HTTP 403 (`McpHttpError.status`). */
export function isForbidden(error: unknown): boolean {
  return reportsStatus(error, 403);
}

/**
 * Errnos of a fetch that will not do better on a second try, or only at a long cost: no server
 * there (refused, not found, host or network unreachable), and undici's connect timeout, a wait of
 * about ten seconds that two retries would triple. Node and undici put them in the `code` of the
 * error under `fetch failed`.
 */
const GIVE_UP_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);
/**
 * The errno names are also in their messages (`connect ECONNREFUSED …`), which is all an injected
 * `fetch` may give; the connect timeout and the TLS failures have no such word to go by.
 */
const GIVE_UP_WORDS = /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/;

/**
 * A TLS certificate that fails verification is refused the same way every time. Node reports it
 * by `code`: OpenSSL's X509 verify errors under their own names, and its host name check as
 * `ERR_TLS_CERT_ALTNAME_INVALID`. Matched by prefix: `CERT_*` (`CERT_HAS_EXPIRED`,
 * `CERT_UNTRUSTED`, ...), `ERR_TLS_*` (which also holds its handshake timeout, a wait like the
 * connect timeout) and `UNABLE_TO_*` (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
 * `UNABLE_TO_GET_ISSUER_CERT`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, ...); and by name: the errors
 * of self-signed and malformed chains that share no prefix. Protocol errors (`ERR_SSL_*`, such as
 * https spoken to a plain-HTTP server) are not certificates and keep their retries.
 */
const CERTIFICATE_CODE_PREFIXES = ['CERT_', 'ERR_TLS_', 'UNABLE_TO_'];
const CERTIFICATE_CODES: ReadonlySet<string> = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERROR_IN_CERT_NOT_BEFORE_FIELD',
  'ERROR_IN_CERT_NOT_AFTER_FIELD',
  'HOSTNAME_MISMATCH',
  'INVALID_CA',
  'INVALID_PURPOSE',
  'PATH_LENGTH_EXCEEDED',
]);

const givesUp = (code: string): boolean =>
  GIVE_UP_CODES.has(code) ||
  CERTIFICATE_CODES.has(code) ||
  CERTIFICATE_CODE_PREFIXES.some((prefix) => code.startsWith(prefix));

/** A fetch failure nests two or three levels: `fetch failed`, an AggregateError, an errno error. */
export const MAX_CAUSE_DEPTH = 5;

/**
 * What lies directly beneath an error: its `cause`, and the errors an AggregateError collects,
 * which is what a name that resolves to several addresses (`localhost`) fails with.
 */
export function causesOf(error: object): { cause: unknown; members: unknown[] } {
  return {
    cause: 'cause' in error ? error.cause : undefined,
    members: 'errors' in error && Array.isArray(error.errors) ? error.errors : [],
  };
}

/** `error` and everything below it, depth first. */
export function causeChain(error: unknown, depth = 0): object[] {
  if (typeof error !== 'object' || error === null || depth >= MAX_CAUSE_DEPTH) return [];
  const { cause, members } = causesOf(error);
  return [error, ...[cause, ...members].flatMap((inner) => causeChain(inner, depth + 1))];
}

/**
 * True when another attempt would meet the same failure (or the same long wait). The codes along
 * the cause chain decide; the words of the messages are read only when no error of the chain has a
 * code, as with an injected `fetch`.
 */
function retryIsPointless(error: unknown): boolean {
  const chain = causeChain(error);
  const codes = chain.flatMap((link) =>
    'code' in link && typeof link.code === 'string' ? [link.code] : [],
  );
  if (codes.length > 0) return codes.some(givesUp);
  return chain.some(
    (link) =>
      'message' in link && typeof link.message === 'string' && GIVE_UP_WORDS.test(link.message),
  );
}

/**
 * A failure worth another connect attempt: the server was busy or restarting (408, 429, any 5xx
 * but 501), or the connection broke on the way (reset, timed out, a name lookup that failed for
 * now), which `fetch` reports as `TypeError`. Not worth it: a server that is not there (connection
 * refused, host not found, host or network unreachable), a connect timeout and a TLS certificate
 * that fails verification, because another attempt meets the same thing at the same cost; nor
 * authentication, session and protocol errors.
 */
export function isTransientConnectError(error: unknown): boolean {
  if (error instanceof McpHttpError) {
    const { status } = error;
    return status === 408 || status === 429 || (status >= 500 && status !== 501);
  }
  return error instanceof TypeError && !retryIsPointless(error);
}

/**
 * The HTTP server no longer knows the session (a restart or deploy), so it did not run the
 * request: the caller may open a new connection and send it once more.
 */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof McpSessionExpiredError;
}

export interface MappingDeps {
  resources: ResourceStore;
  log: Logger;
}

export interface MappingContext {
  serverId: string;
  tool?: string;
  uri?: string;
  taskId?: string;
}

export class MappingError extends Error {
  constructor(ctx: MappingContext, detail: string) {
    super(
      `MCP ${ctx.serverId}${ctx.tool ? `/${ctx.tool}` : ''} returned an unusable result: ${detail}`,
    );
    this.name = 'MappingError';
  }
}
