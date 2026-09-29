import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import type { AdapterManagerLike } from './adapter-types.js';
import type { ConfirmReview, McpConnectionState, McpServerConfig } from '@ai/agent-contracts';

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
}

/** An allowed call runs without asking; a refused one may carry the review its confirm shows. */
export type McpPreapproval = { allowed: true } | { allowed: false; review?: ConfirmReview };

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

export type ManagerAccessor = () => AdapterManagerLike | null;

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

export function requireManager(accessor: ManagerAccessor): AdapterManagerLike {
  const manager = accessor();
  if (!manager) throw new McpError('internal', '', 'The MCP connection layer is not ready.');
  return manager;
}

export function isUnauthorized(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (record['status'] === 401 || record['code'] === 401) return true;
  if (typeof record['name'] === 'string' && /unauthorized/i.test(record['name'])) return true;
  const message = error instanceof Error ? error.message : '';
  return /needs-auth|requires authentication|unauthorized/i.test(message);
}

export function isForbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  return record['status'] === 403 || record['code'] === 403;
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
