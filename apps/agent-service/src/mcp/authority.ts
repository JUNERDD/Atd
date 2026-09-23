import { errorMessage, type McpServerConfig, type McpSnapshot } from '@ai/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logging.js';
import type { ResourceStore } from '../resources.js';
import { McpApprovalBroker } from './approval.js';
import { McpHostCallbacks } from './callbacks.js';
import { ControlSession } from './control-session.js';
import { McpFacade } from './facade.js';
import { McpError } from './errors.js';
import { buildSnapshot, McpAuthManager, McpConnectionStates } from './lifecycle.js';
import { loadAdapterInternals, scopeAdapterEnv } from './loader.js';
import type { AdapterInternals, AdapterManagerLike } from './adapter-types.js';
import {
  bearerSecrets,
  loadServerRecords,
  parseServerConfigs,
  reuseKey,
  saveServerRecords,
  toAdapterConfig,
} from './servers.js';
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
  private records: McpServerConfig[] = [];
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

  static forgetForTests(dataDir: string): void {
    McpAuthority.instances.delete(dataDir);
  }

  /**
   * Closes the profile's authority for a stopping service. An in-flight load
   * (the start-up warm-up) settles first, so its control session and stdio
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
    const records = await loadServerRecords(deps.dataDir);
    states.reset(records);
    const holder: { control: ControlSession | null } = { control: null };
    const managerOf = () => managerOverride ?? holder.control?.manager() ?? null;
    const servers = {
      record: (serverId: string) => {
        const found = authority.records.find((entry) => entry.serverId === serverId);
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
    );
    authority.records = records;
    for (const record of records) authority.trackIdentity(record);
    if (!managerOverride) {
      authority.envRestore = scopeAdapterEnv(deps.dataDir);
      const control = await ControlSession.create({
        agentDir: deps.agentDir,
        sessionsDir: deps.sessionsDir,
        cwd: deps.cwd,
        internals,
        config: toAdapterConfig(records),
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

  configured(): McpServerConfig[] {
    return this.records.map((record) => ({ ...record }));
  }

  /** Accepts a new server set; revisions bump on change, removals disconnect. */
  async configure(input: unknown): Promise<McpServerConfig[]> {
    this.assertOpen();
    const parsed = parseServerConfigs(input);
    const previous = new Map(this.records.map((record) => [record.serverId, record]));
    const next: McpServerConfig[] = parsed.map((candidate) => {
      const old = previous.get(candidate.serverId);
      if (!old) return { ...candidate, revision: 1 };
      const { revision: _a, ...oldRest } = old;
      const { revision: _b, ...newRest } = candidate;
      const changed = JSON.stringify(oldRest) !== JSON.stringify(newRest);
      return { ...candidate, revision: changed ? old.revision + 1 : old.revision };
    });
    const incoming = new Map(next.map((record) => [record.serverId, record]));
    for (const [serverId, old] of previous) {
      const updated = incoming.get(serverId);
      if (!updated || updated.disabled) {
        for (const identity of this.identities.get(serverId) ?? [])
          this.transactions.revoke(identity);
        if (!old.disabled || !updated) {
          await this.facade.disconnect(serverId).catch((error: unknown) => {
            this.deps.log.warn('MCP configure disconnect failed.', {
              serverId,
              error: errorMessage(error),
            });
          });
        }
      }
    }
    this.records = next;
    await saveServerRecords(this.deps.dataDir, next);
    this.states.reset(next);
    for (const record of next) this.trackIdentity(record);
    this.snapshotRevision += 1;
    this.audit({
      tool: 'mcp:configure',
      decision: 'applied',
      servers: next.length,
      revision: this.snapshotRevision,
    });
    return this.configured();
  }

  /** Revokes a server immediately: no new calls, cancellable ones cancel. */
  async revoke(serverId: string): Promise<void> {
    this.assertOpen();
    const record = this.records.find((entry) => entry.serverId === serverId);
    if (!record)
      throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
    for (const identity of this.identities.get(serverId) ?? []) this.transactions.revoke(identity);
    this.records = this.records.map((entry) =>
      entry.serverId === serverId ? { ...entry, disabled: true } : entry,
    );
    await saveServerRecords(this.deps.dataDir, this.records);
    await this.facade.disconnect(serverId).catch(() => undefined);
    this.states.set(serverId, 'disabled', '');
    this.snapshotRevision += 1;
    this.audit({ server: serverId, tool: 'mcp:revoke', decision: 'revoked' });
  }

  snapshot(): McpSnapshot {
    return buildSnapshot(this.records, this.states, this.snapshotRevision, (serverId) =>
      this.counts(serverId),
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
        records: this.configured(),
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

  private counts(serverId: string): { tools: number; resources: number; prompts: number } {
    try {
      const manager = this.managerOverride ?? this.control?.manager() ?? null;
      const all = manager?.getAllConnections?.();
      const names = all
        ? [...all.keys()].filter((name) => name === serverId || name.startsWith(`${serverId}__t__`))
        : [serverId];
      const total = { tools: 0, resources: 0, prompts: 0 };
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
