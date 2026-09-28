import type { PluginRunSnapshot, ResolvedCatalog } from '../model/records.js';

/**
 * What one run may use: the revisions of enabled installed plugins that have at least one
 * effective item, and the qualified names of effective items grouped by kind. Items keep catalog
 * order (plugin order, then component order), so equal catalogs produce equal snapshots. Every
 * enabled installed plugin must have an entry in `revisions`; one without is left out of `plugins`.
 */
export function createRunSnapshot(
  catalog: ResolvedCatalog,
  revisions: Record<string, string>,
): PluginRunSnapshot {
  const effective = catalog.items.filter((item) => item.enabled);
  const plugins = catalog.plugins.flatMap((plugin) => {
    const revision = Object.hasOwn(revisions, plugin.id) ? revisions[plugin.id] : undefined;
    const used =
      plugin.origin === 'installed' &&
      plugin.enabled &&
      effective.some((item) => item.pluginId === plugin.id);
    return used && revision !== undefined ? [{ id: plugin.id, revision }] : [];
  });
  const items: PluginRunSnapshot['items'] = {
    skill: [],
    agent: [],
    command: [],
    mcp: [],
    memory: [],
  };
  for (const item of effective) items[item.kind].push(item.name);
  return { plugins, items };
}
