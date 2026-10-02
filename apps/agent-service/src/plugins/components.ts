import type { McpServerConfig, ServiceCommandFull } from '@atd/agent-contracts';
import type {
  ComponentKind,
  InstalledPlugin,
  PluginDiagnostic,
  PluginRunSnapshot,
  ResolvedItem,
  SubstitutionContext,
} from '@atd/plugin-kit';
import type { SkillRevisionRecord } from '../skills/versions.js';
import { PluginHost, type PluginView } from './host.js';
import { mapCommand } from './map-commands.js';
import { mapAgent, mapMcp, mapSkill, type PluginAgent } from './map.js';

/** One mapped component with the resolved item that says whether it is effective. */
export interface Mapped<T> {
  item: ResolvedItem;
  value: T;
}

/** Installed plugins' components as service models, plus what mapping reported per plugin. */
export interface PluginComponents {
  skills: Mapped<SkillRevisionRecord>[];
  agents: Mapped<PluginAgent>[];
  mcp: Mapped<McpServerConfig>[];
  commands: Mapped<ServiceCommandFull>[];
  /** Mapping and substitution diagnostics by plugin id, beside the plugin's own. */
  diagnostics: Map<string, PluginDiagnostic[]>;
}

function report(components: PluginComponents, pluginId: string, found: PluginDiagnostic[]): void {
  if (!found.length) return;
  components.diagnostics.set(pluginId, [...(components.diagnostics.get(pluginId) ?? []), ...found]);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Maps the components of every installed plugin in `view`, restricted to `kinds`. Items are
 * mapped whether or not they are effective, so lists can show them switched off; callers that
 * build a run filter on `item.enabled` or a run snapshot. A component that fails to map is left
 * out with a diagnostic on its plugin, never failing the others.
 */
export async function mapPluginComponents(
  host: PluginHost,
  view: PluginView,
  kinds: ReadonlySet<ComponentKind>,
): Promise<PluginComponents> {
  const components: PluginComponents = {
    skills: [],
    agents: [],
    mcp: [],
    commands: [],
    diagnostics: new Map(),
  };
  const items = new Map(
    view.catalog.items.map((item) => [`${item.pluginId}\0${item.kind}\0${item.localName}`, item]),
  );
  for (const plugin of view.installed) {
    const wanted = plugin.plugin.components.filter((component) => kinds.has(component.kind));
    if (!wanted.length) continue;
    let context: SubstitutionContext;
    try {
      context = await host.substitution(plugin);
    } catch (error) {
      report(components, plugin.id, [pluginProblem(plugin, messageOf(error))]);
      continue;
    }
    for (const component of wanted) {
      const item = items.get(`${plugin.id}\0${component.kind}\0${component.name}`);
      if (!item) continue;
      try {
        if (component.kind === 'skill')
          components.skills.push({ item, value: await mapSkill(host, plugin, component, context) });
        else if (component.kind === 'agent')
          components.agents.push({ item, value: mapAgent(plugin, component, context) });
        else if (component.kind === 'mcp') {
          const { record, diagnostics } = mapMcp(plugin, component, context, item.enabled);
          report(components, plugin.id, diagnostics);
          if (record) components.mcp.push({ item, value: record });
        } else {
          const { command, diagnostics } = mapCommand(plugin, component, context, item.enabled);
          report(components, plugin.id, diagnostics);
          if (command) components.commands.push({ item, value: command });
        }
      } catch (error) {
        report(components, plugin.id, [
          {
            level: 'warning',
            code: 'invalid-component',
            message: `${component.kind} "${component.name}" could not be loaded: ${messageOf(error)}`,
            component: { kind: component.kind, name: component.name },
          },
        ]);
      }
    }
  }
  return components;
}

function pluginProblem(plugin: InstalledPlugin, message: string): PluginDiagnostic {
  return {
    level: 'error',
    code: 'invalid-component',
    message: `Plugin "${plugin.id}" could not be prepared: ${message}`,
  };
}

/** Resolves the plugins of `dataDir` now and maps the components of `kinds`. */
export async function currentPluginComponents(
  dataDir: string,
  kinds: readonly ComponentKind[],
): Promise<{ view: PluginView; components: PluginComponents }> {
  const host = await PluginHost.for(dataDir);
  const view = await host.view();
  return { view, components: await mapPluginComponents(host, view, new Set(kinds)) };
}

/** Whether a run snapshot lets a run use the item of one mapped component. */
export function inSnapshot(snapshot: PluginRunSnapshot, item: ResolvedItem): boolean {
  return snapshot.items[item.kind].includes(item.name);
}
