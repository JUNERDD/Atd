import type { PluginDetail, PluginItem, PluginSummary } from '@ai/agent-contracts';
import type {
  InstalledPlugin,
  PluginComponent,
  PluginDiagnostic,
  ResolvedItem,
  ResolvedPlugin,
} from '@ai/plugin-kit';
import { LedgerNotFound } from '../ledger.js';
import { mapPluginComponents } from './components.js';
import type { PluginHost, PluginView } from './host.js';
import { CORE_PLUGIN, hostItemKey, SHARED_PLUGIN } from './host-plugins.js';

/** The wire summary of one resolved plugin, with mapping diagnostics when there are any. */
export function toSummary(
  plugin: ResolvedPlugin,
  extra: readonly PluginDiagnostic[] = [],
): PluginSummary {
  return { ...plugin, diagnostics: [...plugin.diagnostics, ...extra] };
}

export function findPlugin(view: PluginView, id: string): ResolvedPlugin {
  const plugin = view.catalog.plugins.find((entry) => entry.id === id);
  if (!plugin) throw new LedgerNotFound('Plugin', id);
  return plugin;
}

export function findInstalled(view: PluginView, id: string): InstalledPlugin {
  const installed = view.installed.find((entry) => entry.id === id);
  if (!installed) throw new TypeError(`Invalid request: "${id}" is a built-in plugin.`);
  return installed;
}

/** What a component says about itself; an MCP server has no description, so its endpoint. */
function componentDescription(component: PluginComponent): string {
  if (component.kind !== 'mcp') return component.description;
  const { transport } = component;
  return transport.type === 'stdio'
    ? [transport.command, ...transport.args].join(' ')
    : transport.url;
}

/**
 * Items of installed and shared plugins are toggled or duplicated, never edited (D8); Core's
 * items are restored rather than edited. Only Personal items are editable.
 */
function isReadOnly(plugin: ResolvedPlugin): boolean {
  return plugin.origin === 'installed' || plugin.id === SHARED_PLUGIN || plugin.id === CORE_PLUGIN;
}

function toItem(
  view: PluginView,
  plugin: ResolvedPlugin,
  installed: InstalledPlugin | undefined,
  item: ResolvedItem,
): PluginItem {
  const component = installed?.plugin.components.find(
    (entry) => entry.kind === item.kind && entry.name === item.localName,
  );
  const description = component
    ? componentDescription(component)
    : (view.host.descriptions.get(hostItemKey(plugin.id, item.kind, item.localName)) ?? '');
  const title = view.host.titles.get(hostItemKey(plugin.id, item.kind, item.localName));
  return {
    pluginId: item.pluginId,
    kind: item.kind,
    localName: item.localName,
    name: item.name,
    ...(title === undefined ? {} : { title: title.slice(0, 256) }),
    description: description.slice(0, 4000),
    itemEnabled: item.itemEnabled,
    enabled: item.enabled,
    ...(item.blockedBy ? { blockedBy: item.blockedBy } : {}),
    readOnly: isReadOnly(plugin),
  };
}

/**
 * One plugin with its items, user config and config state. Sensitive values are reported only as
 * set or not; non-sensitive ones with their stored value. Mapping diagnostics (skipped
 * components, substitution problems) join the plugin's own.
 */
export async function pluginDetail(
  host: PluginHost,
  view: PluginView,
  id: string,
): Promise<PluginDetail> {
  const plugin = findPlugin(view, id);
  const installed = view.installed.find((entry) => entry.id === id);
  const items = view.catalog.items
    .filter((item) => item.pluginId === id)
    .map((item) => toItem(view, plugin, installed, item));
  if (!installed) return { plugin: toSummary(plugin), items, userConfig: [], config: {} };
  const scoped: PluginView = { ...view, installed: [installed] };
  const mapped = await mapPluginComponents(
    host,
    scoped,
    new Set(['skill', 'agent', 'command', 'mcp']),
  );
  const stored = view.state.config[id] ?? {};
  const secrets = (await host.secretsSet([installed]))[id] ?? [];
  const config: PluginDetail['config'] = {};
  for (const option of installed.plugin.userConfig) {
    const value = Object.hasOwn(stored, option.key) ? stored[option.key] : undefined;
    config[option.key] = option.sensitive
      ? { set: secrets.includes(option.key) }
      : value === undefined
        ? { set: false }
        : { set: true, value };
  }
  return {
    plugin: toSummary(plugin, mapped.diagnostics.get(id) ?? []),
    manifest: installed.plugin.manifest,
    resolved: installed.resolved,
    items,
    userConfig: installed.plugin.userConfig,
    config,
  };
}
