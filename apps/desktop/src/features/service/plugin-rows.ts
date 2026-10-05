import {
  PluginDetailSchema,
  PluginDuplicateResponseSchema,
  PluginInstallPreviewSchema,
  PluginSummarySchema,
  parse,
  type PluginDetail,
  type PluginDuplicateResponse,
  type PluginInstallPreview,
  type PluginItem,
  type PluginPreviewRequest,
  type PluginSummary,
} from '@atd/agent-contracts';
import type { ExtensionAgentRow, ExtensionMcpRow, ExtensionSkillRow } from './extension-rows';

/**
 * Plugins as the renderer reads them. The service owns the plugin model (which plugin an item
 * belongs to, what is enabled and why); the bridge answers plain data, so every DTO is checked
 * against its contract schema here before a page reads it.
 */

export type PluginSourceSpec = PluginPreviewRequest['source'];

/** The Personal plugin: the user's own commands, skills, subagents, MCP servers and memory. */
export const USER_PLUGIN_ID = 'user';

/** A list row; null when the service sent one outside the contract, so the rest still show. */
export function asPluginSummary(value: unknown): PluginSummary | null {
  try {
    return parse(PluginSummarySchema, value);
  } catch {
    return null;
  }
}

/** The answer of `plugin` and of every plugin mutation; throws when it breaks the contract. */
export function asPluginDetail(value: unknown): PluginDetail {
  return parse(PluginDetailSchema, value);
}

export function asInstallPreview(value: unknown): PluginInstallPreview {
  return parse(PluginInstallPreviewSchema, value);
}

export function asDuplicateResult(value: unknown): PluginDuplicateResponse {
  return parse(PluginDuplicateResponseSchema, value);
}

/**
 * The list's groups, in order: built-ins, then what the user brought: their own Personal plugin,
 * the shared skills folder, and the plugins they installed (in the service's list order).
 */
export type PluginSection = 'builtin' | 'personal';
export const PLUGIN_SECTIONS: readonly PluginSection[] = ['builtin', 'personal'];

export function pluginSection(plugin: Pick<PluginSummary, 'id' | 'origin'>): PluginSection {
  return plugin.origin === 'host' && plugin.id.startsWith('builtin:') ? 'builtin' : 'personal';
}

/** What a plugin's source badge says; installed plugins name where they were fetched from. */
export type PluginSourceBadge = 'builtin' | 'personal' | 'shared' | PluginSourceSpec['kind'];

export function pluginSourceBadge(
  plugin: Pick<PluginSummary, 'id' | 'origin' | 'source'>,
): PluginSourceBadge | null {
  if (plugin.origin === 'installed') return plugin.source?.kind ?? null;
  if (plugin.id === USER_PLUGIN_ID) return 'personal';
  return plugin.id.startsWith('builtin:') ? 'builtin' : 'shared';
}

/** The source as the user would type it: a path, an npm spec, or a Git URL with its pin. */
export function pluginSourceText(source: PluginSourceSpec): string {
  switch (source.kind) {
    case 'local':
      return source.path;
    case 'npm':
      return source.spec;
    case 'git':
      // `#ref`, `#ref:subdir` or `#:subdir`, as the install field reads it (plugin-source.ts).
      return source.ref || source.subdir
        ? `${source.url}#${source.ref ?? ''}${source.subdir ? `:${source.subdir}` : ''}`
        : source.url;
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}

/**
 * The skill, subagent and MCP rows of one plugin page. The plugin's items decide membership and
 * each item's own switch; the catalog lists add what a row shows beyond that (a skill's built-in
 * state, an agent's permissions, a server's connection). An item the lists do not carry, as a
 * catalog still loading, keeps a row with what the detail knows.
 */
export function pluginKindRows(
  detailItems: readonly PluginItem[],
  origin: PluginSummary['origin'],
  lists: {
    skills: readonly ExtensionSkillRow[];
    agents: readonly ExtensionAgentRow[];
    mcp: readonly ExtensionMcpRow[];
  },
): { skills: ExtensionSkillRow[]; agents: ExtensionAgentRow[]; mcp: ExtensionMcpRow[] } {
  const of = (kind: PluginItem['kind']) => detailItems.filter((item) => item.kind === kind);
  const ref = (item: PluginItem) => ({ pluginId: item.pluginId, readOnly: item.readOnly });
  return {
    skills: of('skill').map((item) => {
      const row = lists.skills.find((entry) => entry.name === item.name);
      return row
        ? { ...row, ...ref(item), enabled: item.itemEnabled }
        : {
            name: item.name,
            description: item.description,
            sourceKind: origin === 'installed' ? 'plugin' : '',
            system: false,
            builtin: null,
            revision: '',
            enabled: item.itemEnabled,
            ...ref(item),
          };
    }),
    agents: of('agent').map((item) => {
      const row = lists.agents.find((entry) => entry.name === item.name);
      const inherit = { tools: null, approval: null };
      return row
        ? { ...row, ...ref(item), enabled: item.itemEnabled }
        : {
            name: item.name,
            description: item.description,
            permissions: inherit,
            customized: false,
            defaults: inherit,
            model: '',
            systemPrompt: '',
            enabled: item.itemEnabled,
            ...ref(item),
          };
    }),
    mcp: of('mcp').map((item) => {
      const row = lists.mcp.find((entry) => entry.serverId === item.name);
      return row
        ? { ...row, ...ref(item), disabled: !item.itemEnabled }
        : {
            serverId: item.name,
            state: '',
            lastError: '',
            disabled: !item.itemEnabled,
            // Unknown until the status list has the server, which then offers its approval.
            approval: 'notRequired' as const,
            toolCount: 0,
            resourceCount: 0,
            promptCount: 0,
            ...ref(item),
          };
    }),
  };
}
