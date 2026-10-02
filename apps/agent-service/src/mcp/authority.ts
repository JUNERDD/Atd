import {
  errorMessage,
  type McpServerConfig,
  type McpServerUpsertRequest,
  type McpSnapshot,
} from '@atd/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import { KeyringBackend } from '../credentials/keyring.js';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import { McpApprovalBroker } from './approval.js';
import { migrateSignIns } from './authority-migration.js';
import { McpNotices } from './callbacks.js';
import { CatalogMemory } from './catalog-memory.js';
import { countCatalog } from './catalog.js';
import { ConnectionManager } from './connect.js';
import { McpError } from './errors.js';
import { McpFacade } from './facade.js';
import { LaunchApprovals } from './launch-approvals.js';
import { resolveHttpUrl, resolveLaunch } from './launch-resolve.js';
import { buildSnapshot, McpConnectionStates } from './lifecycle.js';
import { McpAuthManager } from './oauth-flow.js';
import { OAuthProviders } from './oauth-provider.js';
import { upsertRecord } from './server-edits.js';
import { McpServerRecords, type RecordChange } from './server-records.js';
import { bearerSecrets, reuseKey, toLaunchSpec } from './servers.js';
import { loadRunMcpSelection } from './staging.js';
import { prepareMcpTools, type McpProxyHost } from './tool-proxies.js';
import { CredentialTransactions } from './transactions.js';
import { createTransport } from './transports.js';
import type { McpAuthorityOptions, McpConnections } from './types.js';

/**
 * Single MCP authority per service profile (D6): the composition root of the server records,
 * launch approvals, connection states, connections, sign-in flow and facade. Runners and routes
 * reach MCP only through the facade. No model session takes part in MCP management, so nothing
 * here can call a model.
 */

export interface McpAuthorityDeps {
  serviceId: string;
  dataDir: string;
  /** Where a stdio server without its own cwd starts. */
  cwd: string;
  events: EventLog;
  confirms: ConfirmStore;
  resources: ResourceStore;
  log: Logger;
  audit?: (entry: Record<string, unknown>) => void;
}

export class McpAuthority {
  private snapshotRevision = 0;
  private closed = false;
  private readonly identities = new Map<string, Set<string>>();

  private constructor(
    private readonly deps: McpAuthorityDeps,
    private readonly audit: (entry: Record<string, unknown>) => void,
    readonly states: McpConnectionStates,
    readonly transactions: CredentialTransactions,
    readonly approvals: McpApprovalBroker,
    readonly facade: McpFacade,
    readonly authManager: McpAuthManager,
    /** Where the open connections and their catalog counts live (mcp/connect.ts). */
    private readonly connections: McpConnections,
    /** User servers and the read-only plugin layer (mcp/server-records.ts). */
    private readonly servers: McpServerRecords,
    /** Whether each server may launch (mcp/launch-approvals.ts). */
    readonly launches: LaunchApprovals,
    /** Each server's last-known catalog counts (mcp/catalog-memory.ts). */
    private readonly memory: CatalogMemory,
  ) {}

  private static readonly instances = new Map<string, Promise<McpAuthority>>();

  /** Singleton per profile root; concurrent callers share the in-flight load. */
  static authorityFor(deps: McpAuthorityDeps): Promise<McpAuthority> {
    const existing = McpAuthority.instances.get(deps.dataDir);
    if (existing) return existing;
    const pending = McpAuthority.createAuthority(deps);
    void pending.catch(() => McpAuthority.instances.delete(deps.dataDir));
    McpAuthority.instances.set(deps.dataDir, pending);
    return pending;
  }

  /** Builds an authority outside the per-profile cache; `options` are test seams. */
  static async createAuthority(
    deps: McpAuthorityDeps,
    options: McpAuthorityOptions = {},
  ): Promise<McpAuthority> {
    return McpAuthority.assemble(deps, options);
  }

  /**
   * Reloads the plugin layer of the profile's authority after a plugin change. An authority that
   * is not loaded yet reads the layer when it loads, so this never loads one.
   */
  static async refreshPlugins(dataDir: string): Promise<void> {
    const authority = await McpAuthority.instances.get(dataDir)?.catch(() => null);
    if (authority && !authority.closed)
      await authority.apply('mcp:plugins', await authority.servers.reloadPlugins());
  }

  static forgetForTests(dataDir: string): void {
    McpAuthority.instances.delete(dataDir);
  }

  /**
   * Closes the profile's authority for a stopping service. An in-flight load (a first MCP use
   * still loading) settles first, so its connections and stdio children cannot outlive the
   * service; a failed load left nothing to close.
   */
  static async closeFor(dataDir: string): Promise<void> {
    const authority = await McpAuthority.instances.get(dataDir)?.catch(() => null);
    await authority?.close();
  }

  /**
   * Wires the layers in dependency order: records and states, then the saved sign-ins (moved in
   * from pi-mcp-adapter before anything can connect or sign in), launch approvals, the
   * connections they gate, the facade over those and the sign-in flow.
   */
  private static async assemble(
    deps: McpAuthorityDeps,
    options: McpAuthorityOptions,
  ): Promise<McpAuthority> {
    const audit =
      deps.audit ?? ((entry: Record<string, unknown>) => deps.log.debug('MCP audit.', entry));
    const states = new McpConnectionStates(deps.log, deps.dataDir);
    const transactions = new CredentialTransactions();
    const approvals = new McpApprovalBroker(deps.confirms, audit, deps.log);
    const records = await McpServerRecords.load(deps.dataDir, deps.serviceId, deps.log);
    states.reset(records.all());
    const memory = await CatalogMemory.load(deps.dataDir, deps.log);
    memory.retain(records.all().map((record) => record.serverId));
    const providers = new OAuthProviders({
      serviceId: deps.serviceId,
      keyring: new KeyringBackend(deps.serviceId),
      log: deps.log,
      // OAuth requests to the server's origin carry the record's own headers, resolved as a connect
      // resolves them (R8); a header that cannot be resolved fails the request, sanitized.
      headersFor: async (record) => {
        const launch = await resolveLaunch(record, toLaunchSpec(record), {
          defaultCwd: deps.cwd,
          env: process.env,
          bearerToken: null,
        });
        return launch.kind === 'stdio' ? {} : launch.headers;
      },
    });
    await migrateSignIns(deps, records, providers, states);
    // The gate needs the connections' launch spec and the connections need the gate: the closure
    // breaks the cycle, and nothing calls it before `connections` exists.
    const launches = await LaunchApprovals.load(deps, records, (record) =>
      connections.launchSpec(record),
    );
    const connections = new ConnectionManager({
      servers: records,
      secrets: bearerSecrets(deps.serviceId),
      states,
      txns: transactions,
      launch: launches,
      oauth: providers,
      counter: countCatalog,
      transports: options.transports ?? createTransport,
      memory,
      defaultCwd: deps.cwd,
      log: deps.log,
    });
    const facade = new McpFacade({
      connections,
      states,
      approvals,
      mapping: { resources: deps.resources, log: deps.log },
      audit,
      log: deps.log,
    });
    const authManager = new McpAuthManager({
      servers: records,
      launch: launches,
      states,
      txns: transactions,
      connections,
      providers,
      resolveHttpUrl,
      notices: new McpNotices(deps.events, deps.log),
      audit,
      log: deps.log,
      identitiesFor: (serverId) => [...(authority.identities.get(serverId) ?? [])],
    });
    const authority = new McpAuthority(
      deps,
      audit,
      states,
      transactions,
      approvals,
      facade,
      authManager,
      connections,
      records,
      launches,
      memory,
    );
    for (const record of records.all()) authority.trackIdentity(record);
    return authority;
  }

  private trackIdentity(record: McpServerConfig): void {
    const set = this.identities.get(record.serverId) ?? new Set<string>();
    set.add(reuseKey(record));
    this.identities.set(record.serverId, set);
  }

  /** The user's servers (servers.json) in full; clients and the model see `serverView`s. */
  configured(): McpServerConfig[] {
    return this.servers.userRecords();
  }

  /** The servers a run may reference and bind: the user's and its frozen plugin servers. */
  runServers(runId: string): Promise<McpServerConfig[]> {
    return this.servers.forRun(runId);
  }

  /** Adds or updates one user server from an edit (merged by `upsertRecord`); answers it saved. */
  async upsert(serverId: string, request: McpServerUpsertRequest): Promise<McpServerConfig> {
    const previous = this.configured().find((record) => record.serverId === serverId);
    return this.put(upsertRecord(serverId, request, previous));
  }

  /** Stores one complete user record (a plugin server's copy); answers it as saved. */
  async put(record: McpServerConfig): Promise<McpServerConfig> {
    this.assertOpen();
    const change = this.servers.putUser(record);
    const saved = change.next.find((entry) => entry.serverId === record.serverId);
    if (!saved) throw new McpError('internal', record.serverId, 'The MCP server was not saved.');
    await this.apply('mcp:upsert', change);
    return saved;
  }

  /** Turns one user server on or off; turning it off disconnects it. */
  async setEnabled(serverId: string, enabled: boolean): Promise<void> {
    this.assertOpen();
    await this.apply('mcp:enabled', this.servers.setUserEnabled(serverId, enabled));
  }

  /** Removes one user server: OAuth logs out, and the save deletes its keyring entries. */
  async remove(serverId: string): Promise<void> {
    this.assertOpen();
    const change = this.servers.removeUser(serverId);
    const removed = change.previous.find((record) => record.serverId === serverId);
    if (removed) await this.authManager.forget(removed);
    await this.apply('mcp:remove', change);
    await this.launches.forget(serverId);
  }

  /** Revokes a user server immediately: no new calls, cancellable ones cancel. */
  async revoke(serverId: string): Promise<void> {
    this.assertOpen();
    await this.apply('mcp:revoke', this.servers.setUserEnabled(serverId, false));
  }

  /**
   * Applies a change of one layer. Every server it drops or disables first loses its credentials'
   * transactions, so a connect under way for it is refused. Then the change commits, and only then
   * `disconnectLeaving` closes those servers: a connect that began before the commit with the old
   * record is closed too, and a change that fails to commit closes nothing. Then the dropped servers
   * lose their remembered counts, and states, identities and the snapshot revision follow.
   */
  private async apply(tool: string, change: RecordChange): Promise<void> {
    const incoming = new Map(change.next.map((record) => [record.serverId, record]));
    const leaving = change.previous.filter((old) => incoming.get(old.serverId)?.disabled ?? true);
    for (const old of leaving) {
      for (const identity of this.identities.get(old.serverId) ?? [])
        this.transactions.revoke(identity);
    }
    await change.commit();
    for (const old of leaving) {
      if (old.disabled && incoming.has(old.serverId)) continue;
      await this.connections.disconnectLeaving(old.serverId).catch((error: unknown) => {
        this.deps.log.warn('MCP disconnect failed.', {
          serverId: old.serverId,
          error: errorMessage(error),
        });
      });
    }
    for (const old of change.previous)
      if (!incoming.has(old.serverId)) this.memory.forget(old.serverId);
    const all = this.servers.all();
    this.states.reset(all);
    for (const record of all) this.trackIdentity(record);
    this.snapshotRevision += 1;
    this.audit({
      tool,
      decision: 'applied',
      servers: change.next.length,
      revision: this.snapshotRevision,
    });
  }

  /** Every server's connection status; `launches.status` makes the rows clients list. */
  snapshot(): McpSnapshot {
    return buildSnapshot(this.servers.all(), this.states, this.snapshotRevision, (serverId) =>
      this.connections.counts(serverId),
    );
  }

  /** Binds run-frozen runner proxies; catalog changes never leak into a run. */
  async prepareRunnerTools(host: McpProxyHost, signal?: AbortSignal) {
    this.assertOpen();
    // T6b additive: a frozen staged selection narrows the bind; absent
    // staging preserves bind-all. A missing file is not an error.
    const selection = await loadRunMcpSelection(this.deps.dataDir, host.runId()).catch(() => null);
    return prepareMcpTools(
      host,
      {
        facade: this.facade,
        records: await this.runServers(host.runId()),
        ...(selection ? { selected: selection.tools } : {}),
      },
      signal,
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const identities of this.identities.values()) {
      for (const identity of identities) this.transactions.revoke(identity);
    }
    // Sign-ins end first, so no callback starts a token exchange while the connections close; then
    // every connection closes and waits for OAuth refreshes to save their rotated tokens.
    await this.authManager
      .closeAll()
      .catch((error: unknown) => this.closeFailed('sign-ins', error));
    await this.connections
      .closeAll()
      .catch((error: unknown) => this.closeFailed('connections', error));
    McpAuthority.instances.delete(this.deps.dataDir);
  }

  private closeFailed(what: string, error: unknown): void {
    this.deps.log.warn(`MCP ${what} did not close cleanly.`, { error: errorMessage(error) });
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The MCP authority is closed.');
  }
}
