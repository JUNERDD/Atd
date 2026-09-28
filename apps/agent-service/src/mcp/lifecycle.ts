import {
  errorMessage,
  type McpAuthCompleteResponse,
  type McpAuthStartResponse,
  type McpConnectionState,
  type McpServerConfig,
  type McpServerStatus,
  type McpSnapshot,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type { AdapterAuthFlow, AdapterManagerLike, AdapterServerEntry } from './adapter-types.js';
import { CredentialTransactions, LateWritebackProhibited, TxnAborted } from './transactions.js';
import type { McpHostCallbacks } from './callbacks.js';
import { classifyRedirect, physicalName, reuseKey, toAdapterServerEntry } from './servers.js';
import type { McpStateSink, ManagerAccessor, ServerResolver } from './errors.js';

/**
 * Connection states + explicit auth operations (D6). States are
 * disabled/disconnected/connecting/auth_required/ready/error/closing.
 * Auth start returns the URL immediately (page waits never hold the
 * credential lock); complete checks the generation and rolls back late
 * writebacks; refresh is an explicit reconnect, never a silent replay.
 */

export class McpConnectionStates implements McpStateSink {
  private readonly states = new Map<string, { state: McpConnectionState; lastError: string }>();

  constructor(private readonly log: Logger) {}

  set(serverId: string, state: McpConnectionState, lastError = ''): void {
    this.states.set(serverId, { state, lastError });
    this.log.debug('MCP connection state changed.', { serverId, state });
  }

  get(serverId: string): McpConnectionState {
    return this.states.get(serverId)?.state ?? 'disconnected';
  }

  lastError(serverId: string): string {
    return this.states.get(serverId)?.lastError ?? '';
  }

  reset(records: McpServerConfig[]): void {
    const known = new Set(records.map((record) => record.serverId));
    for (const id of [...this.states.keys()]) {
      if (!known.has(id)) this.states.delete(id);
    }
    for (const record of records) {
      if (!this.states.has(record.serverId)) {
        this.states.set(record.serverId, {
          state: record.disabled ? 'disabled' : 'disconnected',
          lastError: '',
        });
      } else if (record.disabled) {
        this.states.set(record.serverId, { state: 'disabled', lastError: '' });
      } else if (this.states.get(record.serverId)?.state === 'disabled') {
        // Re-enabled: it starts over as a server that has not connected yet.
        this.states.set(record.serverId, { state: 'disconnected', lastError: '' });
      }
    }
  }
}

export interface AuthDeps {
  servers: ServerResolver;
  states: McpConnectionStates;
  txns: CredentialTransactions;
  authFlow: AdapterAuthFlow;
  manager: ManagerAccessor;
  callbacks: McpHostCallbacks;
  audit: (entry: Record<string, unknown>) => void;
  log: Logger;
  /** All txn identities ever issued for a server (revoke fans out). */
  identitiesFor: (serverId: string) => string[];
}

export class McpAuthManager {
  constructor(private readonly deps: AuthDeps) {}

  private manager(): AdapterManagerLike {
    const manager = this.deps.manager();
    if (!manager) throw new Error('The MCP connection layer is not ready.');
    return manager;
  }

  /** Starts OAuth; the URL publishes immediately, page waits hold no lock. */
  async start(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpAuthStartResponse> {
    const record = this.deps.servers.record(serverId);
    assertOAuthHttp(record);
    signal?.throwIfAborted();
    const identity = reuseKey(record);
    const physical = physicalName(record, taskId);
    this.deps.audit({ server: serverId, tool: 'mcp:auth-start', decision: 'request' });
    try {
      const started = await this.deps.txns.runTokenOp(
        identity,
        ({ signal: txnSignal, generation }) =>
          this.deps.authFlow
            .startAuth(physical, record.http?.url ?? '', toAuthEntry(record), { signal: txnSignal })
            .then((result) => ({ result, generation })),
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
      const url =
        typeof started.result.authorizationUrl === 'string'
          ? started.result.authorizationUrl
          : null;
      if (!url) {
        this.deps.states.set(serverId, 'disconnected', '');
        this.deps.audit({ server: serverId, tool: 'mcp:auth-start', decision: 'authenticated' });
        return { serverId, authenticated: true, authorizationUrl: null, mode: 'oauth' };
      }
      this.deps.states.set(serverId, 'auth_required', '');
      this.deps.callbacks.authUrl(serverId, url);
      this.deps.audit({ server: serverId, tool: 'mcp:auth-start', decision: 'url-issued' });
      const redirectKind = classifyRedirect(
        record.http?.auth.type === 'oauth' ? (record.http.auth.redirectUri ?? null) : null,
      );
      return {
        serverId,
        authenticated: false,
        authorizationUrl: url,
        mode: redirectKind === 'loopback' ? 'oauth' : 'manual-redirect',
      };
    } catch (error) {
      if (isAbortLike(error, signal)) {
        this.deps.states.set(serverId, 'disconnected', '');
        throw error instanceof Error ? error : new Error('MCP auth start was cancelled.');
      }
      this.deps.states.set(serverId, 'error', errorMessage(error));
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Completes OAuth from a redirect URL/code; late writebacks roll back. */
  async complete(
    serverId: string,
    input: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpAuthCompleteResponse> {
    const record = this.deps.servers.record(serverId);
    assertOAuthHttp(record);
    signal?.throwIfAborted();
    const identity = reuseKey(record);
    const physical = physicalName(record, taskId);
    this.deps.audit({ server: serverId, tool: 'mcp:auth-complete', decision: 'request' });
    try {
      const generation = this.deps.txns.generation(identity);
      const status = await this.deps.txns.runTokenOp(
        identity,
        ({ signal: txnSignal }) =>
          this.deps.authFlow.completeAuthFromInput(physical, input, { signal: txnSignal }),
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
      // Generation check AFTER the adapter write: a revoke that landed
      // mid-flight rolls the late write back out of the token store.
      try {
        await this.deps.txns.commitChecked(identity, generation, async () => undefined);
      } catch (error) {
        if (error instanceof LateWritebackProhibited) {
          await this.deps.authFlow.removeAuth(physical).catch(() => undefined);
          this.deps.states.set(serverId, 'disconnected', '');
          this.deps.audit({
            server: serverId,
            tool: 'mcp:auth-complete',
            decision: 'revoked-rollback',
          });
        }
        throw error;
      }
      if (status !== 'authenticated') {
        this.deps.states.set(serverId, 'auth_required', '');
        throw new Error(`MCP authentication for ${serverId} did not complete.`);
      }
      await this.manager()
        .close(physical)
        .catch(() => undefined);
      this.deps.states.set(serverId, 'disconnected', '');
      this.deps.audit({ server: serverId, tool: 'mcp:auth-complete', decision: 'authenticated' });
      return { serverId, authenticated: true };
    } catch (error) {
      if (error instanceof LateWritebackProhibited) throw error;
      if (isAbortLike(error, signal)) {
        this.deps.states.set(serverId, 'auth_required', '');
        throw error instanceof Error ? error : new Error('MCP auth completion was cancelled.');
      }
      if (this.deps.states.get(serverId) !== 'auth_required') {
        this.deps.states.set(serverId, 'error', errorMessage(error));
      }
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Explicit refresh: drops the connection and reconnects under the token
   * lock so same-credential refreshes serialize. Never replays tool calls.
   */
  async refresh(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    if (!record.http) throw new Error(`MCP server ${serverId} is not an HTTP server.`);
    const identity = reuseKey(record);
    const physical = physicalName(record, taskId);
    this.deps.states.set(serverId, 'connecting', '');
    this.deps.audit({ server: serverId, tool: 'mcp:refresh', decision: 'request' });
    try {
      await this.deps.txns.runTokenOp(
        identity,
        async ({ signal: txnSignal }) => {
          await this.manager().close(physical);
          txnSignal.throwIfAborted();
          await this.manager().connect(physical, toAdapterServerEntry(record), txnSignal);
        },
        { kind: 'refresh', ...(signal ? { signal } : {}) },
      );
      this.deps.states.set(serverId, 'ready', '');
      this.deps.audit({ server: serverId, tool: 'mcp:refresh', decision: 'ready' });
    } catch (error) {
      if (isAbortLike(error, signal)) {
        this.deps.states.set(serverId, 'disconnected', '');
        throw error instanceof Error ? error : new Error('MCP refresh was cancelled.');
      }
      this.deps.states.set(
        serverId,
        this.deps.states.get(serverId) === 'ready' ? 'ready' : 'error',
        errorMessage(error),
      );
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Logs out: revokes in-flight/future token ops, deletes stored tokens. */
  async logout(serverId: string, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    for (const identity of this.deps.identitiesFor(serverId)) this.deps.txns.revoke(identity);
    const names = taskId ? [physicalName(record, taskId)] : this.physicalNames(record);
    for (const name of names) {
      await this.deps.authFlow.removeAuth(name).catch((error: unknown) => {
        this.deps.log.warn('MCP token removal failed.', { serverId, error: errorMessage(error) });
      });
      await this.manager()
        .close(name)
        .catch(() => undefined);
    }
    this.deps.states.set(serverId, 'disconnected', '');
    this.deps.audit({ server: serverId, tool: 'mcp:logout', decision: 'logged-out' });
  }

  private physicalNames(record: { serverId: string }): string[] {
    const names = new Set<string>([record.serverId]);
    try {
      const all = this.manager().getAllConnections?.();
      if (all) {
        for (const name of all.keys()) {
          if (name === record.serverId || name.startsWith(`${record.serverId}__t__`))
            names.add(name);
        }
      }
    } catch {
      names.add(record.serverId);
    }
    return [...names];
  }
}

function assertOAuthHttp(record: McpServerConfig): void {
  if (!record.http || record.http.auth.type !== 'oauth') {
    throw new Error(`MCP server ${record.serverId} is not configured for OAuth over HTTP.`);
  }
}

/** Invocation aborts, txn cancels and lifecycle aborts all end the op. */
function isAbortLike(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted || error instanceof TxnAborted) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TxnAborted');
}

function toAuthEntry(record: McpServerConfig): AdapterServerEntry {
  return {
    url: record.http?.url,
    auth: 'oauth',
    oauth: {
      ...(record.http?.auth.type === 'oauth' && record.http.auth.scope
        ? { scope: record.http.auth.scope }
        : {}),
      ...(record.http?.auth.type === 'oauth' && record.http.auth.redirectUri
        ? { redirectUri: record.http.auth.redirectUri }
        : {}),
    },
  };
}

/** Snapshotter shape T34int/T5 consume; counts come from live connections. */
export function buildSnapshot(
  records: McpServerConfig[],
  states: McpConnectionStates,
  revision: number,
  counts: (serverId: string) => { tools: number; resources: number; prompts: number },
): McpSnapshot {
  const servers: McpServerStatus[] = records.map((record) => {
    const count = counts(record.serverId);
    return {
      serverId: record.serverId,
      connectionId: record.connectionId,
      configRevision: record.revision,
      state: states.get(record.serverId),
      toolCount: count.tools,
      resourceCount: count.resources,
      promptCount: count.prompts,
      disabled: record.disabled,
      lastError: states.lastError(record.serverId),
    };
  });
  return { revision, servers };
}

/**
 * Tool, resource and prompt counts of one logical server across its connections (the base name
 * and per-task aliases); zero while none is connected or the manager is unavailable.
 */
export function connectionCounts(
  manager: AdapterManagerLike | null,
  serverId: string,
): { tools: number; resources: number; prompts: number } {
  const total = { tools: 0, resources: 0, prompts: 0 };
  try {
    const all = manager?.getAllConnections?.();
    const names = all
      ? [...all.keys()].filter((name) => name === serverId || name.startsWith(`${serverId}__t__`))
      : [serverId];
    for (const name of names) {
      const connection = manager?.getConnection(name);
      if (!connection || connection.status !== 'connected') continue;
      total.tools = Math.max(total.tools, connection.tools.length);
      total.resources = Math.max(total.resources, connection.resources.length);
      total.prompts = Math.max(total.prompts, connection.prompts.length);
    }
    return total;
  } catch {
    return { tools: 0, resources: 0, prompts: 0 };
  }
}
