import { errorMessage, type McpServerConfig } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import type {
  AdapterConnectionLike,
  AdapterManagerLike,
  AdapterRequestOptions,
  AdapterServerEntry,
} from './adapter-types.js';
import { CredentialTransactions } from './transactions.js';
import {
  isUnauthorized,
  McpError,
  requireManager,
  type ManagerAccessor,
  type McpStateSink,
  type SecretResolver,
  type ServerResolver,
} from './errors.js';
import { physicalName, probeStdioRuntime, reuseKey, toAdapterServerEntry } from './servers.js';

/**
 * Connection lifecycle for one logical server: lazy ensure, explicit
 * connect/disconnect/reconnect over physical names (base or per-task
 * alias). Reconnects rediscover the catalog and never replay tool calls.
 * Token handshakes run inside the credential seam; states stay logical.
 */

export interface ConnectionDeps {
  manager: ManagerAccessor;
  servers: ServerResolver;
  secrets: SecretResolver;
  states: McpStateSink;
  txns: CredentialTransactions;
  log: Logger;
}

export interface EnsuredConnection {
  record: McpServerConfig;
  connection: AdapterConnectionLike;
  physical: string;
}

export class ConnectionManager {
  constructor(private readonly deps: ConnectionDeps) {}

  manager(): AdapterManagerLike {
    return requireManager(this.deps.manager);
  }

  requestOptions(name: string, signal?: AbortSignal): AdapterRequestOptions | undefined {
    try {
      return this.manager().getRequestOptions?.(name, signal) ?? (signal ? { signal } : undefined);
    } catch {
      return signal ? { signal } : undefined;
    }
  }

  async ensure(
    serverId: string,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<EnsuredConnection> {
    const record = this.deps.servers.record(serverId);
    if (record.disabled)
      throw new McpError('forbidden', serverId, `MCP server ${serverId} is disabled.`);
    const physical = physicalName(record, taskId);
    const state = this.deps.states.get(serverId);
    if (state === 'closing')
      throw new McpError('conflict', serverId, `MCP server ${serverId} is closing.`);
    if (state === 'auth_required') {
      throw new McpError('auth_required', serverId, `MCP server ${serverId} needs authentication.`);
    }
    const existing = this.manager().getConnection(physical);
    if (existing && existing.status === 'connected' && (state === 'ready' || state === 'error')) {
      if (state !== 'ready') this.deps.states.set(serverId, 'ready', '');
      return { record, connection: existing, physical };
    }
    if (existing?.status === 'needs-auth') {
      this.deps.states.set(serverId, 'auth_required', '');
      throw new McpError('auth_required', serverId, `MCP server ${serverId} needs authentication.`);
    }
    await this.connect(serverId, signal, taskId);
    const connection = this.manager().getConnection(physical);
    if (!connection || connection.status !== 'connected') {
      throw new McpError('auth_required', serverId, `MCP server ${serverId} needs authentication.`);
    }
    return { record, connection, physical };
  }

  async connect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    if (record.disabled) {
      this.deps.states.set(serverId, 'disabled', '');
      throw new McpError('forbidden', serverId, `MCP server ${serverId} is disabled.`);
    }
    if (this.deps.states.get(serverId) === 'closing') {
      throw new McpError('conflict', serverId, `MCP server ${serverId} is closing.`);
    }
    this.deps.states.set(serverId, 'connecting', '');
    try {
      const entry = await this.buildEntry(record);
      const physical = physicalName(record, taskId);
      const connection = await this.deps.txns.runTokenOp(
        reuseKey(record),
        ({ signal: txnSignal }) => this.manager().connect(physical, entry, txnSignal),
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
      if (connection.status === 'needs-auth') {
        this.deps.states.set(serverId, 'auth_required', '');
        throw new McpError(
          'auth_required',
          serverId,
          `MCP server ${serverId} needs authentication.`,
        );
      }
      this.deps.states.set(serverId, 'ready', '');
    } catch (error) {
      throw this.translateConnectError(record, error, signal);
    }
  }

  /** Disconnects the base connection and every per-task alias. */
  async disconnect(serverId: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    this.deps.states.set(serverId, 'closing', '');
    for (const name of this.physicalNames(record)) {
      try {
        await this.manager().close(name);
      } catch (error) {
        this.deps.log.warn('MCP disconnect failed; state still moves on.', {
          serverId,
          name,
          error: errorMessage(error),
        });
      }
    }
    this.deps.states.set(serverId, record.disabled ? 'disabled' : 'disconnected', '');
  }

  /**
   * Reconnects and rediscovers the catalog. Prior tool results are never
   * replayed; callers re-issue only calls whose outcome is known safe.
   */
  async reconnect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    if (record.disabled) {
      this.deps.states.set(serverId, 'disabled', '');
      throw new McpError('forbidden', serverId, `MCP server ${serverId} is disabled.`);
    }
    this.deps.states.set(serverId, 'connecting', '');
    try {
      const entry = await this.buildEntry(record);
      const physical = physicalName(record, taskId);
      const stale = this.manager().getConnection(physical);
      const connection = await this.deps.txns.runTokenOp(
        reuseKey(record),
        ({ signal: txnSignal }) =>
          stale && stale.status === 'connected'
            ? this.manager().reconnect(physical, entry, stale, txnSignal)
            : this.manager().connect(physical, entry, txnSignal),
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
      await connection.client.listTools(undefined, this.requestOptions(physical, signal));
      if (connection.status === 'needs-auth') {
        this.deps.states.set(serverId, 'auth_required', '');
        throw new McpError(
          'auth_required',
          serverId,
          `MCP server ${serverId} needs authentication.`,
        );
      }
      this.deps.states.set(serverId, 'ready', '');
    } catch (error) {
      throw this.translateConnectError(record, error, signal);
    }
  }

  /** Base name plus every live task alias for one logical server. */
  physicalNames(record: McpServerConfig): string[] {
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

  private async buildEntry(record: McpServerConfig): Promise<AdapterServerEntry> {
    const entry = toAdapterServerEntry(record);
    if (record.stdio) {
      const probe = await probeStdioRuntime(record.stdio.command, {
        cwd: record.stdio.cwd ?? undefined,
        env: record.stdio.env,
      });
      if (!probe.ok || !probe.resolved) throw new Error(probe.detail);
      entry.command = probe.resolved;
    }
    if (record.http?.auth.type === 'bearer') {
      const token = await this.deps.secrets.bearerToken(record);
      if (!token) {
        throw new McpError(
          'auth_required',
          record.serverId,
          `MCP server ${record.serverId} is missing its bearer credential.`,
        );
      }
      entry.bearerToken = token;
    }
    return entry;
  }

  private translateConnectError(
    record: McpServerConfig,
    error: unknown,
    signal?: AbortSignal,
  ): McpError | Error {
    if (error instanceof McpError && error.code === 'auth_required') return error;
    if (signal?.aborted) {
      this.deps.states.set(record.serverId, 'disconnected', '');
      return error instanceof Error ? error : new Error(String(error));
    }
    if (isUnauthorized(error)) {
      this.deps.states.set(record.serverId, 'auth_required', '');
      return new McpError(
        'auth_required',
        record.serverId,
        `MCP server ${record.serverId} needs authentication.`,
      );
    }
    const detail = diagnoseConnectError(record, error);
    this.deps.states.set(record.serverId, 'error', detail);
    return new McpError('internal', record.serverId, detail);
  }
}

function diagnoseConnectError(record: McpServerConfig, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (record.stdio && /ENOENT|not found|no such file/i.test(message)) {
    return `MCP server ${record.serverId} failed to start (${record.stdio.command}): ${message}. Bundle the runtime with the service; there is no hidden global fallback.`;
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
    return `MCP server ${record.serverId} is unreachable: ${message}.`;
  }
  return `MCP server ${record.serverId} failed to connect: ${message}`;
}
