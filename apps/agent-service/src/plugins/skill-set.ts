import type { PluginRunSnapshot, ResolvedItem } from '@ai/plugin-kit';
import type { SkillRevisionRecord } from '../skills/versions.js';
import { mapPluginComponents } from './components.js';
import { PluginHost, type PluginView } from './host.js';
import { CORE_PLUGIN, SHARED_PLUGIN, USER_PLUGIN } from './host-plugins.js';

/**
 * What the plugin catalog adds to the skill catalog (skills/versions.ts `loadSkillCatalog`):
 * the installed plugins' skills, which of them are effective, and whether the shared
 * `~/.agents/skills` plugin is on. Host skills keep their own harness switch.
 */
export interface PluginSkillSet {
  /**
   * Installed plugin skills that own their name: one blocked by a `collision` is left out, since
   * the name belongs to another skill (a host skill, or an earlier plugin's). One not in
   * `effective` is listed as turned off.
   */
  records: SkillRevisionRecord[];
  /** The resolved item of each record, by name: its plugin and local name. */
  items: ReadonlyMap<string, ResolvedItem>;
  effective: ReadonlySet<string>;
  sharedEnabled: boolean;
}

/**
 * The skill set of `view`. With a run snapshot, effectiveness is what the run froze; without,
 * it is the live resolution.
 */
export async function pluginSkillSet(
  host: PluginHost,
  view: PluginView,
  snapshot?: PluginRunSnapshot,
): Promise<PluginSkillSet> {
  const mapped = await mapPluginComponents(host, view, new Set(['skill']));
  const owned = mapped.skills.filter(({ item }) => item.blockedBy !== 'collision');
  const effective = snapshot
    ? new Set(snapshot.items.skill)
    : new Set(owned.filter(({ item }) => item.enabled).map(({ item }) => item.name));
  return {
    records: owned.map(({ value }) => value),
    items: new Map(owned.map(({ item, value }) => [value.name, item])),
    effective,
    sharedEnabled: view.catalog.plugins.some(
      (plugin) => plugin.id === SHARED_PLUGIN && plugin.enabled,
    ),
  };
}

/** The skill set as resolved now, for listings and lookups outside a run. */
export async function currentPluginSkillSet(dataDir: string): Promise<PluginSkillSet> {
  const host = await PluginHost.for(dataDir);
  return pluginSkillSet(host, await host.view());
}

/** The plugin that contributes a catalog skill row: the record's own, else by source kind. */
export function skillPluginId(
  record: Pick<SkillRevisionRecord, 'sourceKind' | 'pluginId'>,
  system: boolean,
): string {
  if (record.pluginId) return record.pluginId;
  if (record.sourceKind === 'agents') return SHARED_PLUGIN;
  return system ? CORE_PLUGIN : USER_PLUGIN;
}
