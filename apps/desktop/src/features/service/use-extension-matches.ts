import { useTranslation } from 'react-i18next';
import type { PluginSummary } from '@atd/agent-contracts';
import { matchFields, type FieldsMatch } from '@atd/ui/lib/fuzzy-match';
import type { ExtensionCommandRow } from './extension-commands';
import {
  skillSourceLabelKey,
  type ExtensionAgentRow,
  type ExtensionMcpRow,
  type ExtensionSkillRow,
} from './extension-rows';
import { usePluginLabels } from './use-plugin-labels';
import { mcpNeedsApproval, useMcpApprovalLabel, useMcpStateLabel } from './use-mcp-state-label';

/** One catalog row as listed: its description line and where the search marked it. */
export interface ExtensionMatch<Row, Field extends string> {
  row: Row;
  description: string;
  match: FieldsMatch<Field> | null;
}

export type SkillMatch = ExtensionMatch<ExtensionSkillRow, 'name' | 'description'>;
export type AgentMatch = ExtensionMatch<ExtensionAgentRow, 'name' | 'description'>;
export type McpMatch = ExtensionMatch<ExtensionMcpRow, 'serverId' | 'description'>;
export type CommandMatch = ExtensionMatch<ExtensionCommandRow, 'name' | 'description'>;

/** A plugin's contributions of each kind, as rows with their description lines. */
export interface ExtensionItemMatches {
  commands: CommandMatch[];
  skills: SkillMatch[];
  agents: AgentMatch[];
  mcp: McpMatch[];
}

/** One search result group: a plugin and what of it matched. */
export interface PluginMatches extends ExtensionItemMatches {
  plugin: PluginSummary;
  /** Where the search marked the plugin's own row; null when only its items matched. */
  match: FieldsMatch<'name' | 'description'> | null;
}

export type ExtensionCatalogs = {
  commands: readonly ExtensionCommandRow[];
  skills: readonly ExtensionSkillRow[];
  agents: readonly ExtensionAgentRow[];
  mcp: readonly ExtensionMcpRow[];
};

function filterRows<Row, Field extends string>(
  rows: readonly Row[],
  query: string,
  describe: (row: Row) => { description: string; fields: Record<Field, string> },
): ExtensionMatch<Row, Field>[] {
  const searching = Boolean(query.trim());
  return rows.flatMap((row) => {
    const { description, fields } = describe(row);
    const match = matchFields(query, fields);
    return match || !searching ? [{ row, description, match }] : [];
  });
}

/**
 * Builds the description line each command, skill, subagent and MCP row shows (an MCP server's
 * launch approval when it waits for one, its state and last error) and filters the
 * catalogs by one query, which matches and marks the name (or server id) and that line. An empty
 * query keeps every row, as a plugin page lists them.
 */
export function useExtensionMatches(
  query: string,
  catalogs: ExtensionCatalogs,
): ExtensionItemMatches {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const approvalLabel = useMcpApprovalLabel();
  const line = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
  return {
    commands: filterRows(catalogs.commands, query, (row) => ({
      description: row.description,
      fields: { name: row.name, description: row.description },
    })),
    skills: filterRows(catalogs.skills, query, (row) => {
      const sourceKey = row.system
        ? 'extensions.sourceSystem'
        : skillSourceLabelKey(row.sourceKind);
      // A plugin's skill is listed under its plugin, whose row already names the source and
      // version; the rendered revision id would only add noise.
      const description =
        row.sourceKind === 'plugin'
          ? row.description
          : line([row.description, sourceKey ? t(sourceKey) : '', row.revision]);
      return { description, fields: { name: row.name, description } };
    }),
    agents: filterRows(catalogs.agents, query, (row) => {
      const description = line([
        row.description,
        row.customized ? t('extensions.customPermissions') : '',
      ]);
      return { description, fields: { name: row.name, description } };
    }),
    mcp: filterRows(catalogs.mcp, query, (row) => {
      // A launch waiting for approval leads the line; its connection state then says no more.
      const waiting = mcpNeedsApproval(row.approval);
      const description = line([
        waiting ? approvalLabel(row.approval) : null,
        waiting && row.state === 'approval_required' ? null : stateLabel(row.state),
        row.lastError,
      ]);
      return { description, fields: { serverId: row.serverId, description } };
    }),
  };
}

/**
 * Search over the whole Extensions section: each plugin's name and description, and every item it
 * contributes, grouped by the plugin the service attributes the item to. A plugin shows when it or
 * any of its items matched, in list order.
 */
export function usePluginMatches(
  query: string,
  plugins: readonly PluginSummary[],
  catalogs: ExtensionCatalogs,
): PluginMatches[] {
  const labels = usePluginLabels();
  const items = useExtensionMatches(query, catalogs);
  return plugins.flatMap((plugin) => {
    const match = matchFields(query, {
      name: labels.name(plugin),
      description: labels.description(plugin),
    });
    const group: PluginMatches = {
      plugin,
      match,
      commands: items.commands.filter((item) => item.row.pluginId === plugin.id),
      skills: items.skills.filter((item) => item.row.pluginId === plugin.id),
      agents: items.agents.filter((item) => item.row.pluginId === plugin.id),
      mcp: items.mcp.filter((item) => item.row.pluginId === plugin.id),
    };
    const hits =
      group.commands.length + group.skills.length + group.agents.length + group.mcp.length;
    return match || hits ? [group] : [];
  });
}
