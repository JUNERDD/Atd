import { errorMessage, type McpServerConfig } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import type { CountMemory } from './catalog-memory.js';
import { MCP_REQUEST_TIMEOUT_MS } from './constants.js';
import { ConnectOvertaken, translateConnectError } from './connect-errors.js';
import { McpError, type McpStateSink, type SecretResolver, type ServerResolver } from './errors.js';
import type { LaunchGate } from './launch-approvals.js';
import { resolveLaunch, withConfiguredUrl } from './launch-resolve.js';
import { McpConnectionPool, type PoolTarget } from './pool.js';
import { physicalName, probeStdioRuntime, reuseKey, toLaunchSpec } from './servers.js';
import type { CredentialTransactions } from './transactions.js';
import type {
  EnsuredConnection,
  McpCatalogCounter,
  McpCatalogCounts,
  McpConnections,
  McpCredentialAuth,
  McpLaunchSpec,
  McpLiveConnection,
  McpTransportFactory,
} from './types.js';

/**
 * Connection lifecycle for one logical server: lazy ensure, explicit connect/disconnect/reconnect
 * over physical names (base or per-task alias). Reconnects rediscover the catalog and never replay
 * tool calls. Token handshakes run inside the credential seam; states stay logical. The open
 * clients live in the pool (mcp/pool.ts), which this class feeds one resolved target at a time.
 */

export interface ConnectionDeps {
  servers: ServerResolver;
  secrets: SecretResolver;
  states: McpStateSink;
  txns: CredentialTransactions;
  /** Refuses a launch the user has not approved as it stands (mcp/launch-approvals.ts). */
  launch: LaunchGate;
  /** OAuth credentials of the servers that sign in. */
  oauth: McpCredentialAuth;
  counter: McpCatalogCounter;
  transports: McpTransportFactory;
  /** Keeps each server's last-known counts across restarts. */
  memory: CountMemory;
  /** The authority's cwd: where a stdio server without its own cwd starts. */
  defaultCwd: string;
  log: Logger;
}

export class ConnectionManager implements McpConnections {
  private readonly pool: McpConnectionPool;

  constructor(private readonly deps: ConnectionDeps) {
    this.pool = new McpConnectionPool({
      transports: deps.transports,
      counter: deps.counter,
      log: deps.log,
      counted: (connection) => this.remember(connection),
    });
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
    // A record edited since the connection opened has another key: it reconnects instead.
    const existing = this.pool.get(physical);
    if (existing?.reuseKey === reuseKey(record) && (state === 'ready' || state === 'error')) {
      if (state !== 'ready') this.deps.states.set(serverId, 'ready', '');
      return { record, connection: existing, physical };
    }
    return { record, connection: await this.dial(record, signal, taskId), physical };
  }

  async connect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    await this.dial(this.deps.servers.record(serverId), signal, taskId);
  }

  /**
   * Disconnects the base connection and every per-task alias; their in-flight requests fail. A
   * server that is not configured is `not_found`, before anything changes.
   */
  async disconnect(serverId: string): Promise<void> {
    this.deps.servers.record(serverId);
    await this.disconnectLeaving(serverId);
  }

  /**
   * Closes whatever is open for `serverId` whether or not its record still resolves, then settles
   * the row: `disabled` for a present, disabled record, else `disconnected` (a removed server's row
   * goes with the next reset). `apply` runs it after the change committed, so it also closes a
   * connection that a connect began before the commit opened with the old record.
   */
  async disconnectLeaving(serverId: string): Promise<void> {
    this.deps.states.set(serverId, 'closing', '');
    await Promise.all(
      this.pool.namesOf(serverId).map((name) =>
        this.pool.close(name).catch((error: unknown) => {
          this.deps.log.warn('MCP disconnect failed; state still moves on.', {
            serverId,
            name,
            error: errorMessage(error),
          });
        }),
      ),
    );
    const disabled = this.recordOf(serverId)?.disabled === true;
    this.deps.states.set(serverId, disabled ? 'disabled' : 'disconnected', '');
  }

  /**
   * Reconnects and rediscovers the catalog. The launch is checked before anything closes, and
   * prior tool results are never replayed; callers re-issue only calls whose outcome is known safe.
   */
  async reconnect(serverId: string, signal?: AbortSignal, taskId?: string): Promise<void> {
    const record = this.deps.servers.record(serverId);
    if (record.disabled) {
      this.deps.states.set(serverId, 'disabled', '');
      throw new McpError('forbidden', serverId, `MCP server ${serverId} is disabled.`);
    }
    this.deps.states.set(serverId, 'connecting', '');
    await this.establish(record, signal, taskId, true);
  }

  /**
   * What a connect of `record` would launch, bearer secret aside: the resolved executable and every
   * argument, cwd, env value, URL and header as configured. Launch approvals fingerprint exactly
   * this, so anything that changes what runs must be resolved here.
   */
  async launchSpec(record: McpServerConfig): Promise<McpLaunchSpec> {
    const spec = toLaunchSpec(record);
    if (record.stdio) {
      const probe = await probeStdioRuntime(record.stdio.command, {
        cwd: record.stdio.cwd,
        env: record.stdio.env,
      });
      if (!probe.ok || !probe.resolved) throw new Error(probe.detail);
      spec.command = probe.resolved;
    }
    return spec;
  }

  discard(connection: McpLiveConnection): Promise<void> {
    return this.pool.discard(connection);
  }

  /**
   * What the server offers while any of its connections is open; else what it offered when it last
   * connected under the record's present configuration, and zeros if it never did.
   */
  counts(serverId: string): McpCatalogCounts {
    if (this.pool.namesOf(serverId).some((name) => this.pool.get(name))) {
      return this.pool.counts(serverId);
    }
    const record = this.recordOf(serverId);
    const known = record && this.deps.memory.recall(serverId, reuseKey(record));
    return known ?? { tools: 0, resources: 0, prompts: 0 };
  }

  async closeAll(): Promise<void> {
    await this.pool.closeAll();
    await this.deps.oauth.settled();
    await this.deps.memory.flush();
  }

  /**
   * Notes what a connection offers, under the key it was opened for (the record's now, except
   * between an edit and the reconnect), so an edited server never inherits its old counts. A
   * recount can outlive the server's removal; that must not bring its entry back.
   */
  private remember(connection: McpLiveConnection): void {
    if (!this.recordOf(connection.serverId)) return;
    this.deps.memory.remember(connection.serverId, connection.reuseKey, connection.counts());
  }

  private recordOf(serverId: string): McpServerConfig | undefined {
    try {
      return this.deps.servers.record(serverId);
    } catch {
      return undefined;
    }
  }

  /** Opens (or reuses) the connection; the state follows: connecting, then ready or the failure. */
  private async dial(
    record: McpServerConfig,
    signal?: AbortSignal,
    taskId?: string,
  ): Promise<McpLiveConnection> {
    const { serverId } = record;
    if (record.disabled) {
      this.deps.states.set(serverId, 'disabled', '');
      throw new McpError('forbidden', serverId, `MCP server ${serverId} is disabled.`);
    }
    if (this.deps.states.get(serverId) === 'closing') {
      throw new McpError('conflict', serverId, `MCP server ${serverId} is closing.`);
    }
    this.deps.states.set(serverId, 'connecting', '');
    return this.establish(record, signal, taskId, false);
  }

  /**
   * Resolves the launch and opens the connection inside the record's credential transaction
   * (`replace`: closing the present one first), then moves the row to ready. A revoke, disable or
   * removal that lands meanwhile overtakes the connect: the key's generation is read before anything
   * is resolved, the transaction refuses to start once it moved, and a connection opened for a
   * server that is gone or disabled closes again. The refusal is `ConnectOvertaken`, which leaves
   * the row to the change that overtook it (authority.ts `apply`, oauth-flow.ts `logout`,
   * authority.ts `close`), except that a row this connect left `connecting` returns to
   * `disconnected`: a change whose commit fails settles nothing. A connect that began after the
   * revoke but opened before the commit landed passes both checks; `apply` disconnects the server
   * after the commit (`disconnectLeaving`), which closes it.
   */
  private async establish(
    record: McpServerConfig,
    signal: AbortSignal | undefined,
    taskId: string | undefined,
    replace: boolean,
  ): Promise<McpLiveConnection> {
    const { serverId } = record;
    const { txns, states } = this.deps;
    const identity = reuseKey(record);
    const generation = txns.generation(identity);
    try {
      const target = await this.targetOf(record, taskId);
      return await txns.runTokenOp(
        identity,
        async (txn) => {
          if (txn.generation !== generation) throw new ConnectOvertaken(serverId);
          if (replace) await this.pool.close(target.physical);
          const connection = await this.pool.open(target, txn.signal);
          if (this.overtaken(serverId, identity, generation)) {
            await this.pool.discard(connection);
            throw new ConnectOvertaken(serverId);
          }
          // Set in the step that checked, so no change can land between the two.
          states.set(serverId, 'ready', '');
          return connection;
        },
        { kind: 'exchange', ...(signal ? { signal } : {}) },
      );
    } catch (error) {
      throw translateConnectError(states, record, error, signal);
    }
  }

  /** The key's generation moved, or the server is gone or disabled: what opened since must close. */
  private overtaken(serverId: string, identity: string, generation: number): boolean {
    const record = this.recordOf(serverId);
    return this.deps.txns.generation(identity) !== generation || !record || record.disabled;
  }

  /**
   * The single spawn/dial choke point: nothing reaches the pool before the launch gate has passed
   * the very spec the launch is resolved from.
   */
  private async targetOf(record: McpServerConfig, taskId?: string): Promise<PoolTarget> {
    const spec = await this.launchSpec(record);
    await this.deps.launch.assertLaunch(record, spec);
    const bearer = record.http?.auth.type === 'bearer';
    const launch = await resolveLaunch(record, spec, {
      defaultCwd: this.deps.defaultCwd,
      env: process.env,
      bearerToken: bearer ? await this.deps.secrets.bearerToken(record) : null,
    });
    const physical = physicalName(record, taskId);
    return {
      serverId: record.serverId,
      physical,
      reuseKey: reuseKey(record),
      launch,
      auth:
        launch.kind !== 'stdio' && launch.credential.type === 'oauth'
          ? this.deps.oauth.authFor(record, launch.url)
          : undefined,
      requestTimeoutMs: record.requestTimeoutMs ?? MCP_REQUEST_TIMEOUT_MS,
      idleClose: physical === record.serverId,
      hideUrl: (text) => withConfiguredUrl(text, record),
    };
  }
}
