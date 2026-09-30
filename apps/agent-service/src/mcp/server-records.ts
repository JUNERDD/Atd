import type {
  McpLaunchApprovalState,
  McpServerConfig,
  McpServerStatus,
  McpServerStatusRow,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { McpError, type ServerResolver } from './errors.js';
import {
  assertUserServers,
  loadPluginServerLayer,
  runPluginServers,
  withPluginOwners,
  type PluginServerLayer,
  type PluginServerSource,
} from './plugin-servers.js';
import { McpServerStore } from './server-store.js';
import { parseServerConfigs, reviseRecords } from './servers.js';

/**
 * A pending change to one layer: what it holds and what it will hold. Nothing changes until
 * `commit`, so the authority revokes what the change drops or disables while every record still
 * resolves. It disconnects those servers only after the commit, when a dropped server's record is
 * gone (connections close by server id) and a change that failed to commit has touched nothing.
 */
export interface RecordChange {
  previous: McpServerConfig[];
  next: McpServerConfig[];
  commit(): Promise<void>;
}

/**
 * The MCP server records one authority serves: the user's layer, persisted in `servers.json` with
 * its env and header values in the keyring (mcp/server-store.ts), and the read-only plugin layer
 * (mcp/plugin-servers.ts). This class owns their contents and serves them in full; the authority
 * applies each change to connections, states and credentials.
 */
export class McpServerRecords implements ServerResolver {
  private constructor(
    private readonly dataDir: string,
    private readonly log: Logger,
    private readonly store: McpServerStore,
    private user: McpServerConfig[],
    private plugins: PluginServerLayer,
  ) {}

  static async load(dataDir: string, serviceId: string, log: Logger): Promise<McpServerRecords> {
    const [{ store, records }, plugins] = await Promise.all([
      McpServerStore.load(dataDir, serviceId, log),
      loadPluginServerLayer(dataDir, log),
    ]);
    return new McpServerRecords(dataDir, log, store, records, plugins);
  }

  /** The user's servers: the ones clients and `configure_mcp` edit. */
  userRecords(): McpServerConfig[] {
    return this.user.map((record) => ({ ...record }));
  }

  /** User servers, then the plugin layer's. */
  all(): McpServerConfig[] {
    return [...this.user, ...this.plugins.records].map((record) => ({ ...record }));
  }

  find(serverId: string): McpServerConfig | undefined {
    return this.all().find((record) => record.serverId === serverId);
  }

  /** One server of either layer; an unknown id is `not_found` (the `ServerResolver` contract). */
  record(serverId: string): McpServerConfig {
    const found = this.find(serverId);
    if (!found)
      throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
    return found;
  }

  /** The installed plugin a plugin server comes from; null for a user server. */
  pluginSource(serverId: string): PluginServerSource | null {
    return this.plugins.sources.get(serverId) ?? null;
  }

  /** Whether plugin state still holds approvals from before the service owned them. */
  legacyPluginApprovals(): boolean {
    return this.plugins.legacyApprovals;
  }

  /** The servers a run may reference and bind: the user's and its frozen plugin servers. */
  async forRun(runId: string): Promise<McpServerConfig[]> {
    const plugins = await runPluginServers(this.dataDir, runId, this.plugins);
    return [...this.userRecords(), ...plugins];
  }

  /** Adds or replaces one user server (its revision carried over); plugin ids are refused. */
  putUser(record: McpServerConfig): RecordChange {
    assertUserServers([record.serverId], this.plugins);
    const next = this.user.some((entry) => entry.serverId === record.serverId)
      ? this.user.map((entry) => (entry.serverId === record.serverId ? record : entry))
      : [...this.user, record];
    return this.userChange(reviseRecords(this.user, parseServerConfigs({ servers: next })));
  }

  /** Turns one user server on or off; plugin servers are refused. */
  setUserEnabled(serverId: string, enabled: boolean): RecordChange {
    this.assertUser(serverId);
    return this.userChange(
      this.user.map((entry) =>
        entry.serverId === serverId ? { ...entry, disabled: !enabled } : entry,
      ),
    );
  }

  /** Drops one user server; plugin servers are refused. */
  removeUser(serverId: string): RecordChange {
    this.assertUser(serverId);
    return this.userChange(this.user.filter((entry) => entry.serverId !== serverId));
  }

  private assertUser(serverId: string): void {
    assertUserServers([serverId], this.plugins);
    if (!this.user.some((entry) => entry.serverId === serverId))
      throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
  }

  /** Reads the plugin layer anew from the plugin catalog. */
  async reloadPlugins(): Promise<RecordChange> {
    const layer = await loadPluginServerLayer(this.dataDir, this.log);
    return {
      previous: this.plugins.records,
      next: layer.records,
      commit: async () => {
        this.plugins = layer;
      },
    };
  }

  statusRows(
    servers: readonly McpServerStatus[],
    approvals: ReadonlyMap<string, McpLaunchApprovalState>,
  ): McpServerStatusRow[] {
    return withPluginOwners(servers, this.plugins, approvals);
  }

  /** A user-layer change; committing saves it (file and keyring) first, then serves the new set. */
  private userChange(next: McpServerConfig[]): RecordChange {
    return {
      previous: this.user,
      next,
      commit: async () => {
        await this.store.save(next);
        this.user = next;
      },
    };
  }
}
