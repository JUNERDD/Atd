import { useCallback, useState } from 'react';
import { useSettingsSectionExit } from '../settings/settings-navigation';

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
 * The page stack inside Extensions. Back pops one page and never leaves the list; a search hit
 * enters at its item with the item's plugin below it, so Back lands on that plugin. Leaving the
 * section resets the stack to the list, like every settings section (`useSettingsSectionExit`).
 */
export function useExtensionRoute() {
  const [stack, setStack] = useState<ExtensionRoute[]>([LIST]);
  useSettingsSectionExit(() => setStack([LIST]));
  const route = stack[stack.length - 1] ?? LIST;
  const push = useCallback((next: ExtensionRoute) => setStack((current) => [...current, next]), []);
  const back = useCallback(
    () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    [],
  );
  /** Swaps the current page, as an install landing on the plugin it installed. */
  const replace = useCallback(
    (next: ExtensionRoute) =>
      setStack((current) => [...current.slice(0, Math.max(current.length - 1, 1)), next]),
    [],
  );
  /** Opens an item from the list (a search hit) with its plugin page behind it. */
  const openItem = useCallback(
    (item: { pluginId: string; kind: ExtensionItemKind; name: string }) =>
      setStack([LIST, { level: 'plugin', pluginId: item.pluginId }, { level: 'item', ...item }]),
    [],
  );
  const reset = useCallback(() => setStack([LIST]), []);
  return { route, push, back, replace, openItem, reset };
}
