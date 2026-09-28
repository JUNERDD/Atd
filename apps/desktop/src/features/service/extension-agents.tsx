import { useState } from 'react';
import { Bot, Shield } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentPermissions } from '@ai/agent-contracts';
import { DropdownMenuItem } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { AgentPermissionsDialog } from './extension-agent-permissions';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { ExtensionAgentRow } from './extension-rows';

/**
 * Subagent catalog: the service's system agents, then the markdown specialists (`~/.atd/agents`).
 * Rows share the skill row anatomy (icon ring, name, a description line naming system sources and
 * custom permissions, the enable switch and More with Permissions…); the search matches and marks
 * the name and that line. A row click and More › View details open the agent's details page, and
 * adding one opens the add page from the tab row. Turning an agent off and permission changes
 * apply from the next run.
 */
export function ExtensionAgentsGroup({
  rows,
  query,
  loading,
  empty,
  connected,
  busy,
  onOpen,
  onEnabled,
  onPermissions,
}: {
  rows: ExtensionAgentRow[];
  query: string;
  loading: boolean;
  empty: string;
  connected: boolean;
  busy: boolean;
  /** Opens one agent's details page. */
  onOpen: (name: string) => void;
  onEnabled: (name: string, enabled: boolean) => void;
  /** Saves one agent's permissions for later runs; null restores its defaults. */
  onPermissions: (name: string, permissions: SubagentPermissions | null) => Promise<boolean>;
}) {
  const { t } = useTranslation('settings');
  // The dialog keeps its name while it closes; its row is read live so a save shows in it.
  const [permissions, setPermissions] = useState<{ name: string; open: boolean } | null>(null);
  const permissionsRow = permissions
    ? rows.find((row) => row.name === permissions.name)
    : undefined;
  const shown = rows.flatMap((row) => {
    const description = [
      row.description,
      row.system ? t('extensions.sourceSystem') : '',
      row.customized ? t('extensions.customPermissions') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const match = matchFields(query, { name: row.name, description });
    return match || !query.trim() ? [{ row, description, match }] : [];
  });

  return (
    <>
      <ExtensionGroup
        title={t('extensions.tabSubagents')}
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={false}
        emptyIcon={<Bot />}
      >
        {shown.map(({ row, description, match }) => (
          <ExtensionRow key={row.name} name={row.name} onDetails={() => onOpen(row.name)}>
            <ItemMedia variant="icon">
              <Bot />
            </ItemMedia>
            <ItemContent>
              <ItemTitle title={row.name}>
                <HighlightedText text={row.name} ranges={match?.ranges.name} />
              </ItemTitle>
              {description ? (
                <ItemDescription title={description}>
                  <HighlightedText text={description} ranges={match?.ranges.description} />
                </ItemDescription>
              ) : null}
            </ItemContent>
            <ExtensionRowActions
              name={row.name}
              enabled={row.enabled}
              disabled={!connected}
              onEnabledChange={(enabled) => onEnabled(row.name, enabled)}
              onDetails={() => onOpen(row.name)}
              menu={
                <DropdownMenuItem onSelect={() => setPermissions({ name: row.name, open: true })}>
                  <Shield />
                  {t('extensions.agentPermissionsAction')}
                </DropdownMenuItem>
              }
            />
          </ExtensionRow>
        ))}
      </ExtensionGroup>
      {permissionsRow ? (
        <AgentPermissionsDialog
          row={permissionsRow}
          open={permissions?.open ?? false}
          onOpenChange={(open) => setPermissions({ name: permissionsRow.name, open })}
          disabled={!connected || busy}
          onSave={(value) => onPermissions(permissionsRow.name, value)}
        />
      ) : null}
    </>
  );
}
