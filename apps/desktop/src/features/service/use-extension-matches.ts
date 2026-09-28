import { useTranslation } from 'react-i18next';
import { matchFields, type FieldsMatch } from '@ai/ui/lib/fuzzy-match';
import {
  skillSourceLabelKey,
  type ExtensionAgentRow,
  type ExtensionMcpRow,
  type ExtensionSkillRow,
} from './extension-rows';
import { useMcpStateLabel } from './use-mcp-state-label';

/** One catalog row as listed: its description line and where the search marked it. */
export interface ExtensionMatch<Row, Field extends string> {
  row: Row;
  description: string;
  match: FieldsMatch<Field> | null;
}

export type SkillMatch = ExtensionMatch<ExtensionSkillRow, 'name' | 'description'>;
export type AgentMatch = ExtensionMatch<ExtensionAgentRow, 'name' | 'description'>;
export type McpMatch = ExtensionMatch<ExtensionMcpRow, 'serverId' | 'description'>;

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
 * Builds the description line each Skills/Subagents/MCP row shows and filters all three catalogs
 * by one query, which matches and marks the name (or server id) and that line. An empty query
 * keeps every row. The overview counts these to tell when a search matched nothing anywhere.
 */
export function useExtensionMatches(
  query: string,
  catalogs: { skills: ExtensionSkillRow[]; agents: ExtensionAgentRow[]; mcp: ExtensionMcpRow[] },
): { skills: SkillMatch[]; agents: AgentMatch[]; mcp: McpMatch[] } {
  const { t } = useTranslation('settings');
  const stateLabel = useMcpStateLabel();
  const line = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
  return {
    skills: filterRows(catalogs.skills, query, (row) => {
      const sourceKey = row.system
        ? 'extensions.sourceSystem'
        : skillSourceLabelKey(row.sourceKind);
      const description = line([row.description, sourceKey ? t(sourceKey) : '', row.revision]);
      return { description, fields: { name: row.name, description } };
    }),
    agents: filterRows(catalogs.agents, query, (row) => {
      const description = line([
        row.description,
        row.system ? t('extensions.sourceSystem') : '',
        row.customized ? t('extensions.customPermissions') : '',
      ]);
      return { description, fields: { name: row.name, description } };
    }),
    mcp: filterRows(catalogs.mcp, query, (row) => {
      const description = line([stateLabel(row.state), row.lastError]);
      return { description, fields: { serverId: row.serverId, description } };
    }),
  };
}
