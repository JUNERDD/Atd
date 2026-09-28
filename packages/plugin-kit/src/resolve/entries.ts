import { installedItemName } from './names.js';
import type { PluginDiagnostic } from '../model/diagnostics.js';
import type {
  HostPlugin,
  InstalledPlugin,
  PluginItemKind,
  PluginStateFile,
  ResolvedItem,
  ResolvedPlugin,
} from '../model/records.js';

/** One plugin and its items before collisions are applied. */
export interface CatalogEntry {
  plugin: ResolvedPlugin;
  items: ResolvedItem[];
}

type Blocker = NonNullable<ResolvedItem['blockedBy']>;

/** Own-property lookup: plugin ids such as `constructor` are valid and must not hit the prototype. */
function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function countItems(items: readonly { kind: PluginItemKind }[]): Record<PluginItemKind, number> {
  const counts: Record<PluginItemKind, number> = {
    skill: 0,
    agent: 0,
    command: 0,
    mcp: 0,
    memory: 0,
  };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

function item(
  base: Omit<ResolvedItem, 'enabled' | 'blockedBy'>,
  blockedBy: Blocker | undefined,
): ResolvedItem {
  return blockedBy === undefined
    ? { ...base, enabled: true }
    : { ...base, enabled: false, blockedBy };
}

export function hostEntry(host: HostPlugin, state: PluginStateFile): CatalogEntry {
  const enabled = host.toggleable ? !state.disabled.includes(host.id) : true;
  const items = host.items.map((hostItem) =>
    item(
      {
        pluginId: host.id,
        kind: hostItem.kind,
        localName: hostItem.name,
        name: hostItem.name,
        itemEnabled: hostItem.enabled,
      },
      !enabled ? 'plugin' : !hostItem.enabled ? 'item' : undefined,
    ),
  );
  return {
    plugin: {
      id: host.id,
      origin: 'host',
      name: host.name,
      description: host.description,
      enabled,
      toggleable: host.toggleable,
      removable: false,
      updatable: false,
      needsConfig: false,
      counts: countItems(items),
      diagnostics: [],
    },
    items,
  };
}

/** Required options without a default and without a stored value (or stored secret). */
function missingConfigKeys(
  installed: InstalledPlugin,
  state: PluginStateFile,
  secretsSet: Record<string, string[]>,
): string[] {
  const values = own(state.config, installed.id) ?? {};
  const secrets = own(secretsSet, installed.id) ?? [];
  return installed.plugin.userConfig
    .filter((option) => option.required && option.default === undefined)
    .filter((option) =>
      option.sensitive ? !secrets.includes(option.key) : !Object.hasOwn(values, option.key),
    )
    .map((option) => option.key);
}

export function installedEntry(
  installed: InstalledPlugin,
  state: PluginStateFile,
  secretsSet: Record<string, string[]>,
): CatalogEntry {
  const { id, plugin } = installed;
  const enabled = !state.disabled.includes(id);
  const disabledItems = own(state.items, id) ?? [];
  const approved = own(state.approved, id) ?? [];
  const missing = missingConfigKeys(installed, state, secretsSet);
  const needsConfig = missing.length > 0;
  const items = plugin.components.map((component) => {
    const itemEnabled = !disabledItems.includes(`${component.kind}:${component.name}`);
    const needsApproval =
      component.kind === 'mcp' &&
      component.transport.type === 'stdio' &&
      !approved.includes(component.name);
    const blockedBy: Blocker | undefined = !enabled
      ? 'plugin'
      : !itemEnabled
        ? 'item'
        : needsConfig
          ? 'config'
          : needsApproval
            ? 'approval'
            : undefined;
    return item(
      {
        pluginId: id,
        kind: component.kind,
        localName: component.name,
        name: installedItemName(installed, component.name),
        itemEnabled,
      },
      blockedBy,
    );
  });
  const diagnostics: PluginDiagnostic[] = [...plugin.diagnostics];
  if (needsConfig) {
    diagnostics.push({
      level: 'warning',
      code: 'needs-config',
      message: `Required settings are missing: ${missing.join(', ')}.`,
    });
  }
  return {
    plugin: {
      id,
      origin: 'installed',
      name: id,
      displayName: plugin.manifest.displayName,
      description: plugin.manifest.description ?? '',
      version: plugin.manifest.version,
      format: plugin.format,
      source: installed.source,
      revision: installed.revision,
      license: plugin.manifest.license,
      installedAt: installed.installedAt,
      enabled,
      toggleable: true,
      removable: true,
      updatable: true,
      needsConfig,
      counts: countItems(items),
      diagnostics,
    },
    items,
  };
}
