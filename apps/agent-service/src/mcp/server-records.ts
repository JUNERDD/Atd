import type { McpServerConfig, McpServerStatus, McpServerStatusRow } from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { McpError } from './errors.js';
import {
  assertUserServers,
  loadPluginServerLayer,
  runPluginServers,
  withPluginOwners,
  type PluginServerLayer,
} from './plugin-servers.js';
import { loadServerRecords, reviseRecords, saveServerRecords } from './servers.js';

/**
 * A pending change to one layer: what it holds and what it will hold. Nothing changes until
 * `commit`, so the authority can still reach every server the change drops (to disconnect it)
 * before its record is gone.
 */
export interface RecordChange {
  previous: McpServerConfig[];
  next: McpServerConfig[];
  commit(): Promise<void>;
}

/**
 * The MCP server records one authority serves: the user's layer, persisted in `servers.json`,
 * and the read-only plugin layer (mcp/plugin-servers.ts). This class owns their contents and
 * persistence; the authority applies each change to connections, states and credentials.
 */
export class McpServerRecords {
  private constructor(
    private readonly dataDir: string,
    private readonly log: Logger,
    private user: McpServerConfig[],
    private plugins: PluginServerLayer,
  ) {}

  static async load(dataDir: string, log: Logger): Promise<McpServerRecords> {
    const [user, plugins] = await Promise.all([
      loadServerRecords(dataDir),
      loadPluginServerLayer(dataDir, log),
    ]);
    return new McpServerRecords(dataDir, log, user, plugins);
  }

  /** The user's servers: the ones configure writes and clients edit. */
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

  /** The servers a run may reference and bind: the user's and its frozen plugin servers. */
  async forRun(runId: string): Promise<McpServerConfig[]> {
    const plugins = await runPluginServers(this.dataDir, runId, this.plugins);
    return [...this.userRecords(), ...plugins];
  }

  /** Replaces the user layer (revisions carried over); plugin ids are refused. */
  replaceUser(parsed: McpServerConfig[]): RecordChange {
    assertUserServers(
      parsed.map((server) => server.serverId),
      this.plugins,
    );
    return this.userChange(reviseRecords(this.user, parsed));
  }

  /** Marks one user server disabled; plugin servers are refused. */
  disableUser(serverId: string): RecordChange {
    assertUserServers([serverId], this.plugins);
    if (!this.user.some((entry) => entry.serverId === serverId))
      throw new McpError('not_found', serverId, `MCP server ${serverId} is not configured.`);
    return this.userChange(
      this.user.map((entry) =>
        entry.serverId === serverId ? { ...entry, disabled: true } : entry,
      ),
    );
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

  statusRows(servers: readonly McpServerStatus[]): McpServerStatusRow[] {
    return withPluginOwners(servers, this.plugins);
  }

  /** A user-layer change; committing saves `servers.json` first, then serves the new set. */
  private userChange(next: McpServerConfig[]): RecordChange {
    return {
      previous: this.user,
      next,
      commit: async () => {
        await saveServerRecords(this.dataDir, next);
        this.user = next;
      },
    };
  }
}
