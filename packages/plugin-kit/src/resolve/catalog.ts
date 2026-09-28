import type {
  HostPlugin,
  InstalledPlugin,
  PluginStateFile,
  ResolvedCatalog,
  ResolvedItem,
  ResolvedPlugin,
} from '../model/records.js';
import { hostEntry, installedEntry, type CatalogEntry } from './entries.js';

/** Inputs to one resolution pass. */
export interface ResolveInput {
  host: HostPlugin[];
  installed: InstalledPlugin[];
  state: PluginStateFile;
  /** Keys of sensitive config values that are set in the SecretStore, per plugin. */
  secretsSet: Record<string, string[]>;
}

/**
 * Merges host and installed plugins into one catalog. Host plugins come first in the given
 * order, then installed plugins by name. Effective enablement per item is: plugin enabled
 * (state.disabled; non-toggleable host plugins are always on) AND item enabled (host item flag,
 * or not in state.items for installed plugins) AND, for installed stdio MCP servers, approved
 * AND, for installed plugins, no required user config missing. Two items of one kind with the
 * same qualified name: the first keeps it, later ones are blocked with `collision` and a
 * diagnostic on their plugin. `counts` counts every item, effective or not.
 */
export function resolveCatalog(input: ResolveInput): ResolvedCatalog {
  const installed = [...input.installed].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const entries = [
    ...input.host.map((plugin) => hostEntry(plugin, input.state)),
    ...installed.map((plugin) => installedEntry(plugin, input.state, input.secretsSet)),
  ];
  applyCollisions(entries);
  return {
    plugins: entries.map((entry) => entry.plugin),
    items: entries.flatMap((entry) => entry.items),
  };
}

/**
 * The first item of a kind to claim a qualified name keeps it, in catalog order and whether or
 * not it is enabled, so toggling one plugin never moves a name to another.
 */
function applyCollisions(entries: CatalogEntry[]): void {
  const owners = new Map<string, ResolvedPlugin>();
  for (const { plugin, items } of entries) {
    items.forEach((item, index) => {
      const key = `${item.kind}\u0000${item.name}`;
      const owner = owners.get(key);
      if (owner === undefined) {
        owners.set(key, plugin);
        return;
      }
      plugin.diagnostics.push({
        level: 'warning',
        code: 'collision',
        message: `Plugin "${owner.id}" already provides ${item.kind} "${item.name}"; this one is not used.`,
        component: { kind: item.kind, name: item.localName },
      });
      if (item.blockedBy === undefined) items[index] = blockedByCollision(item);
    });
  }
}

function blockedByCollision(item: ResolvedItem): ResolvedItem {
  return { ...item, enabled: false, blockedBy: 'collision' };
}
