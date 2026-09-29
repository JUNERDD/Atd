import {
  errorMessage,
  type McpLaunchApprovalState,
  type McpServerConfig,
  type McpServerStatus,
  type McpServerStatusRow,
} from '@ai/agent-contracts';
import type { InstalledPlugin } from '@ai/plugin-kit';
import type { Logger } from '../logging.js';
import { currentPluginComponents } from '../plugins/components.js';
import { USER_PLUGIN } from '../plugins/host-plugins.js';
import { loadRunPluginSnapshot } from '../plugins/run-snapshot.js';
import { McpError } from './errors.js';

/**
 * The read-only plugin layer of the MCP authority, next to the user's `servers.json`. Its records
 * come from installed plugins (plugins/map.ts `mapMcp`), keyed by qualified server id; they are
 * never written to `servers.json`, never changed by user-server edits, revoke or `configure_mcp`, and are
 * disabled unless the plugin catalog made them effective. Launching one still needs the user's
 * approval (mcp/launch-approvals.ts), like any user server that runs a local command.
 */
export interface PluginServerLayer {
  records: McpServerConfig[];
  /** Owning plugin by server id. */
  owners: ReadonlyMap<string, string>;
  /** The installed plugin behind each server, as a launch approval shows and binds it. */
  sources: ReadonlyMap<string, PluginServerSource>;
  /** Plugin state still lists approvals from before the service owned them (plugin-kit `approved`). */
  legacyApprovals: boolean;
}

/** The installed plugin revision one plugin server comes from. */
export interface PluginServerSource {
  id: string;
  name: string;
  version: string | null;
  revision: string;
  /** `npm <name>@<version>`, `git <url>@<commit>` or `local <path>`. */
  source: string;
  /** The server's name inside its plugin. */
  localName: string;
}

export const EMPTY_PLUGIN_LAYER: PluginServerLayer = {
  records: [],
  owners: new Map(),
  sources: new Map(),
  legacyApprovals: false,
};

/**
 * Reads the plugin layer as the plugin catalog resolves now. A plugin failure never takes MCP
 * down: it is logged and the layer is empty until the next reload.
 */
export async function loadPluginServerLayer(
  dataDir: string,
  log: Logger,
): Promise<PluginServerLayer> {
  try {
    const { view, components } = await currentPluginComponents(dataDir, ['mcp']);
    const plugins = new Map(view.installed.map((plugin) => [plugin.id, plugin]));
    const sources = new Map<string, PluginServerSource>();
    for (const { item, value } of components.mcp) {
      const plugin = plugins.get(item.pluginId);
      if (plugin) sources.set(value.serverId, serverSource(plugin, item.localName));
    }
    return {
      records: components.mcp.map(({ value }) => value),
      owners: new Map(components.mcp.map(({ item, value }) => [value.serverId, item.pluginId])),
      sources,
      legacyApprovals: Object.values(view.state.approved ?? {}).some((names) => names.length > 0),
    };
  } catch (error) {
    log.warn('Plugin MCP servers could not be loaded.', { error: errorMessage(error) });
    return EMPTY_PLUGIN_LAYER;
  }
}

/**
 * Refuses a user-layer write that names a plugin server. Qualified ids belong to plugins even
 * when none is installed under that name, so a user record can never take one over later.
 */
export function assertUserServers(serverIds: Iterable<string>, layer: PluginServerLayer): void {
  for (const serverId of serverIds) {
    const owner = layer.owners.get(serverId);
    if (owner || serverId.includes(':'))
      throw new McpError(
        'forbidden',
        serverId,
        `MCP server ${serverId} belongs to ${owner ? `plugin ${owner}` : 'a plugin'} and is read-only; turn it on or off from its plugin.`,
      );
  }
}

/**
 * The plugin servers one run may use: those its frozen plugin snapshot (plugins/run-snapshot.ts)
 * made effective. A server turned off after the freeze stays in the list but is disabled, so it
 * is refused like a revoked user server; one turned on after it is not added.
 */
export async function runPluginServers(
  dataDir: string,
  runId: string,
  layer: PluginServerLayer,
): Promise<McpServerConfig[]> {
  if (!layer.records.length) return [];
  const snapshot = await loadRunPluginSnapshot(dataDir, runId);
  if (!snapshot) return [];
  const allowed = new Set(snapshot.items.mcp);
  return layer.records.filter((record) => allowed.has(record.serverId));
}

/** Status rows: each server with its plugin (`user` for servers.json) and launch approval. */
export function withPluginOwners(
  servers: readonly McpServerStatus[],
  layer: PluginServerLayer,
  approvals: ReadonlyMap<string, McpLaunchApprovalState>,
): McpServerStatusRow[] {
  return servers.map((server) => {
    const owner = layer.owners.get(server.serverId);
    return {
      ...server,
      pluginId: owner ?? USER_PLUGIN,
      readOnly: owner !== undefined,
      approval: approvals.get(server.serverId) ?? 'required',
    };
  });
}

function serverSource(plugin: InstalledPlugin, localName: string): PluginServerSource {
  const { source, resolved } = plugin;
  const pinned =
    source.kind === 'npm'
      ? `npm ${packageName(source.spec)}@${resolved.version ?? 'unknown'}`
      : source.kind === 'git'
        ? `git ${source.url}${source.subdir ? `#${source.subdir}` : ''}@${resolved.commit ?? source.ref ?? 'unknown'}`
        : `local ${source.path}`;
  return {
    id: plugin.id,
    name: plugin.plugin.manifest.displayName ?? plugin.id,
    version: plugin.plugin.manifest.version ?? null,
    revision: plugin.revision,
    source: pinned,
    localName,
  };
}

/** `name` of an npm spec `name`, `name@range` or `@scope/name@range`. */
function packageName(spec: string): string {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}
