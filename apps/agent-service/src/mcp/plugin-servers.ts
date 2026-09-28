import {
  errorMessage,
  type McpServerConfig,
  type McpServerStatus,
  type McpServerStatusRow,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { currentPluginComponents } from '../plugins/components.js';
import { USER_PLUGIN } from '../plugins/host-plugins.js';
import { loadRunPluginSnapshot } from '../plugins/run-snapshot.js';
import { McpError } from './errors.js';

/**
 * The read-only plugin layer of the MCP authority, next to the user's `servers.json`. Its records
 * come from installed plugins (plugins/map.ts `mapMcp`), keyed by qualified server id; they are
 * never written to `servers.json`, never changed by configure, revoke or `configure_mcp`, and are
 * disabled unless the plugin catalog made them effective (for stdio, after the user's approval).
 */
export interface PluginServerLayer {
  records: McpServerConfig[];
  /** Owning plugin by server id. */
  owners: ReadonlyMap<string, string>;
}

export const EMPTY_PLUGIN_LAYER: PluginServerLayer = { records: [], owners: new Map() };

/**
 * Reads the plugin layer as the plugin catalog resolves now. A plugin failure never takes MCP
 * down: it is logged and the layer is empty until the next reload.
 */
export async function loadPluginServerLayer(
  dataDir: string,
  log: Logger,
): Promise<PluginServerLayer> {
  try {
    const { components } = await currentPluginComponents(dataDir, ['mcp']);
    return {
      records: components.mcp.map(({ value }) => value),
      owners: new Map(components.mcp.map(({ item, value }) => [value.serverId, item.pluginId])),
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

export function withPluginOwners(
  servers: readonly McpServerStatus[],
  layer: PluginServerLayer,
): McpServerStatusRow[] {
  return servers.map((server) => {
    const owner = layer.owners.get(server.serverId);
    return { ...server, pluginId: owner ?? USER_PLUGIN, readOnly: owner !== undefined };
  });
}
