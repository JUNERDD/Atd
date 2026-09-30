import { useCallback } from 'react';
import { useSettingsPageHistory } from '../settings/use-settings-page-history';
import type { Extensions } from './use-extensions';

/** Item kinds with their own details page here; commands and memory open their own sections. */
export type ExtensionItemKind = 'skill' | 'agent' | 'mcp';

/**
 * One page of the Extensions section. `list` is the plugin overview; `install` fetches and
 * installs a bundle (`updateOf` previews an installed plugin's update instead); `create` adds a
 * Personal subagent or MCP server with its form; `plugin` is one plugin's page (`focus` scrolls to
 * its configuration); `item` is one skill, subagent or MCP server of a plugin.
 */
export type ExtensionRoute =
  | { level: 'list' }
  | { level: 'install'; updateOf?: string }
  | { level: 'create'; kind: 'agent' | 'mcp' }
  | { level: 'plugin'; pluginId: string; focus?: 'config' }
  | { level: 'item'; pluginId: string; kind: ExtensionItemKind; name: string };

const LIST: ExtensionRoute = { level: 'list' };

/**
 * Whether a route's plugin and item are still there, for Forward. A catalog that has not loaded
 * (null or, like the item pages read it, empty) cannot tell, so it counts as there.
 */
function routeAvailable(route: ExtensionRoute, extensions: Extensions): boolean {
  const pluginId =
    route.level === 'install'
      ? route.updateOf
      : route.level === 'plugin' || route.level === 'item'
        ? route.pluginId
        : undefined;
  const plugins = extensions.plugins.plugins;
  if (pluginId !== undefined && plugins && !plugins.some((plugin) => plugin.id === pluginId))
    return false;
  if (route.level !== 'item') return true;
  const names =
    route.kind === 'skill'
      ? extensions.skills.skills?.skills.map((row) => row.name)
      : route.kind === 'agent'
        ? extensions.agents.agents?.agents.map((row) => row.name)
        : extensions.mcp.mcp?.servers.map((row) => row.serverId);
  return !names?.length || names.includes(route.name);
}

/**
 * The Extensions section's page history (`useSettingsPageHistory`) over the list. A search hit
 * enters at its item with the item's plugin page behind it, so Back lands on that plugin.
 */
export function useExtensionRoute(extensions: Extensions) {
  const { route, open, back, leave, replace, reset } = useSettingsPageHistory(LIST, (next) =>
    routeAvailable(next, extensions),
  );
  /** Opens an item from the list (a search hit) with its plugin page behind it. */
  const openItem = useCallback(
    (item: { pluginId: string; kind: ExtensionItemKind; name: string }) =>
      reset({ level: 'plugin', pluginId: item.pluginId }, { level: 'item', ...item }),
    [reset],
  );
  return { route, open, back, leave, replace, openItem };
}
