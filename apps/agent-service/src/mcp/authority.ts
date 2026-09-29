import {
  errorMessage,
  type McpServerConfig,
  type McpServerUpsertRequest,
  type McpSnapshot,
} from '@ai/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import { McpApprovalBroker } from './approval.js';
import { McpHostCallbacks } from './callbacks.js';
import { ControlSession } from './control-session.js';
import { McpFacade } from './facade.js';
import { McpError } from './errors.js';
import {
  buildSnapshot,
  connectionCounts,
  McpAuthManager,
  McpConnectionStates,
} from './lifecycle.js';
import { loadAdapterInternals, scopeAdapterEnv } from './loader.js';
import type { AdapterInternals, AdapterManagerLike } from './adapter-types.js';
import { McpServerRecords, type RecordChange } from './server-records.js';
import { upsertRecord } from './server-edits.js';
import { bearerSecrets, reuseKey, toAdapterConfig } from './servers.js';
import { prepareMcpTools, type McpProxyHost } from './tool-proxies.js';
import { loadRunMcpSelection } from './staging.js';
import { CredentialTransactions } from './transactions.js';

/**
 * Single MCP authority per service profile (D6): one control Pi session
 * loads the adapter; runners reach MCP only through the facade.
 */

export interface McpAuthorityDeps {
  serviceId: string;
  dataDir: string;
  agentDir: string;
  sessionsDir: string;
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
  private envRestore: (() => void) | null = null;
  private readonly identities = new Map<string, Set<string>>();
  private readonly audit: (entry: Record<string, unknown>) => void;

  private constructor(
    private readonly deps: McpAuthorityDeps,
    readonly internals: AdapterInternals,
    readonly states: McpConnectionStates,
    readonly transactions: CredentialTransactions,
    readonly callbacks: McpHostCallbacks,
    readonly approvals: McpApprovalBroker,
    readonly facade: McpFacade,
    readonly authManager: McpAuthManager,
    private control: ControlSession | null,
    private readonly managerOverride: AdapterManagerLike | null,
    /** User servers and the read-only plugin layer (mcp/server-records.ts). */
    private readonly servers: McpServerRecords,
  ) {
    this.audit = deps.audit ?? ((entry) => deps.log.debug('MCP audit.', entry));
  }

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

  static async createAuthority(deps: McpAuthorityDeps): Promise<McpAuthority> {
    return McpAuthority.assemble(deps, null);
  }

  /** Mock seam: injects a manager instead of a control session. */
  static async createAuthorityWithManager(
    deps: McpAuthorityDeps,
    manager: AdapterManagerLike,
  ): Promise<McpAuthority> {
    return McpAuthority.assemble(deps, manager);
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
   * Closes the profile's authority for a stopping service. An in-flight load
   * (a first MCP use still loading) settles first, so its control session and stdio
   * children cannot outlive the service; a failed load left nothing to close.
   */
  static async closeFor(dataDir: string): Promise<void> {
    const authority = await McpAuthority.instances.get(dataDir)?.catch(() => null);
    await authority?.close();
  }

  private static async assemble(
    deps: McpAuthorityDeps,
    managerOverride: AdapterManagerLike | null,
  ): Promise<McpAuthority> {
    const internals = await loadAdapterInternals();
    const states = new McpConnectionStates(deps.log);
    const transactions = new CredentialTransactions();
    const callbacks = new McpHostCallbacks(deps.events, deps.log);
    const audit =
      deps.audit ?? ((entry: Record<string, unknown>) => deps.log.debug('MCP audit.', entry));
    const approvals = new McpApprovalBroker(deps.confirms, audit, deps.log);
    const records = await McpServerRecords.load(deps.dataDir, deps.log);
    states.reset(records.all());
    const holder: { control: ControlSession | null } = { control: null };
    const managerOf = () => managerOverride ?? holder.control?.manager() ?? null;
    const servers = {
      record: (serverId: string) => {
        const found = records.find(serverId);
        if (!found)
          throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
        return found;
      },
    };
    const authority = new McpAuthority(
      deps,
      internals,
      states,
      transactions,
      callbacks,
      approvals,
      new McpFacade({
        internals,
        manager: managerOf,
        servers,
        secrets: bearerSecrets(deps.serviceId),
        states,
        txns: transactions,
        approvals,
        mapping: { resources: deps.resources, log: deps.log },
        audit,
        log: deps.log,
      }),
      new McpAuthManager({
        servers,
        states,
        txns: transactions,
        authFlow: internals.authFlow,
        manager: managerOf,
        callbacks,
        audit,
        log: deps.log,
        identitiesFor: (serverId) => [...(authority.identities.get(serverId) ?? [])],
      }),
      null,
      managerOverride,
      records,
    );
    for (const record of records.all()) authority.trackIdentity(record);
    if (!managerOverride) {
      authority.envRestore = scopeAdapterEnv(deps.dataDir);
      const control = await ControlSession.create({
        agentDir: deps.agentDir,
        sessionsDir: deps.sessionsDir,
        cwd: deps.cwd,
        internals,
        config: toAdapterConfig(records.userRecords()),
        callbacks,
        log: deps.log,
      });
      holder.control = control;
      authority.control = control;
      const manager = await control.waitForManager(30000);
      if (!manager) {
        await control.close('quit').catch(() => undefined);
        throw new Error('The MCP control session did not expose its connection layer.');
      }
      approvals.attachBus(control.pi()?.events ?? null, internals.approvalEvent);
    }
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

  /** Removes one user server and disconnects it; its stored credentials are not touched. */
  async remove(serverId: string): Promise<void> {
    this.assertOpen();
    await this.apply('mcp:remove', this.servers.removeUser(serverId));
  }

  /** Revokes a user server immediately: no new calls, cancellable ones cancel. */
  async revoke(serverId: string): Promise<void> {
    this.assertOpen();
    await this.apply('mcp:revoke', this.servers.setUserEnabled(serverId, false));
  }

  /**
   * Applies a change of one layer: every server it drops or disables loses its credentials'
   * transactions and disconnects while its record still resolves, then the change commits and
   * states, identities and the snapshot revision follow the new set.
   */
  private async apply(tool: string, change: RecordChange): Promise<void> {
    const incoming = new Map(change.next.map((record) => [record.serverId, record]));
    for (const old of change.previous) {
      const updated = incoming.get(old.serverId);
      if (updated && !updated.disabled) continue;
      for (const identity of this.identities.get(old.serverId) ?? [])
        this.transactions.revoke(identity);
      if (!old.disabled || !updated)
        await this.facade.disconnect(old.serverId).catch((error: unknown) => {
          this.deps.log.warn('MCP disconnect failed.', {
            serverId: old.serverId,
            error: errorMessage(error),
          });
        });
    }
    await change.commit();
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

  /** Every server's status, each row naming its plugin (`user` for servers.json). */
  snapshot(): McpSnapshot {
    const manager = this.managerOverride ?? this.control?.manager() ?? null;
    const snapshot = buildSnapshot(this.servers.all(), this.states, this.snapshotRevision, (id) =>
      connectionCounts(manager, id),
    );
    return { ...snapshot, servers: this.servers.statusRows(snapshot.servers) };
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
        normalizeSchema: this.internals.normalizeDirectToolInputSchema,
        ...(selection ? { selected: selection.tools } : {}),
      },
      signal,
    );
  }

  /** Control gateway for status/auth diagnostics (never tool calls). */
  controlGateway(params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.control) throw new Error('Mock authority has no control session.');
    return this.control.callGateway(params, signal);
  }

  /** Zero-model + host-callback diagnostics for proof and status surfaces. */
  diagnostics() {
    return {
      models: this.control?.counts() ?? { prompt: 0, followUp: 0, steer: 0 },
      callbacks: this.callbacks.snapshot(),
      settings: this.control?.settingsProof() ?? null,
      managers: this.control?.observedManagerCount() ?? (this.managerOverride ? 1 : 0),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const identities of this.identities.values()) {
      for (const identity of identities) this.transactions.revoke(identity);
    }
    this.approvals.detach();
    const manager = this.managerOverride ?? this.control?.manager() ?? null;
    if (manager) await manager.closeAll().catch(() => undefined);
    if (this.control) await this.control.close('quit').catch(() => undefined);
    this.control = null;
    this.envRestore?.();
    this.envRestore = null;
    McpAuthority.instances.delete(this.deps.dataDir);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The MCP authority is closed.');
  }
}
