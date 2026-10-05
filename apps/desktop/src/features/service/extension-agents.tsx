import { useState } from 'react';
import { Bot, Shield, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SubagentPermissions } from '@atd/agent-contracts';
import { DropdownMenuItem, DropdownMenuSeparator } from '@atd/ui/components/dropdown-menu';
import { HighlightedText } from '@atd/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@atd/ui/components/item';
import { AgentPermissionsDialog } from './extension-agent-permissions';
import { ExtensionGroup } from './extension-group';
import { ExtensionRemoveDialog } from './extension-remove-dialog';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import type { ExtensionAgentRow } from './extension-rows';
import type { AgentMatch } from './use-extension-matches';

/**
 * One plugin's subagents: the markdown specialists (`~/.atd/agents`, Personal) or an installed
 * plugin's agents. Rows share the skill row anatomy (icon ring, name, a description line naming
 * custom permissions, the enable switch and More with Permissions…, which plugin agents keep as
 * well, and Delete for Personal agents); `items` are the rows shown, with search marks. A row
 * click and More › View details open the agent's details page. Turning an agent off, deleting it
 * and permission changes apply from the next run.
 */
export function ExtensionAgentsGroup({
  title,
  showTitle = true,
  rows,
  items,
  loading,
  empty,
  connected,
  busyId,
  lockedReason,
  onOpen,
  onEnabled,
  onPermissions,
  onDelete,
}: {
  title: string;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
  /** Every agent, so the permissions dialog keeps its row when a save changes what matches. */
  rows: readonly ExtensionAgentRow[];
  items: AgentMatch[];
  loading: boolean;
  empty: string;
  connected: boolean;
  /** The agent a save or delete is running for; only its row waits. */
  busyId: string | null;
  /** Why the switches are locked (their plugin is off); null when they are not. */
  lockedReason: string | null;
  /** Opens one agent's details page. */
  onOpen: (name: string) => void;
  onEnabled: (name: string, enabled: boolean) => void;
  /** Saves one agent's permissions for later runs; null restores its defaults. */
  onPermissions: (name: string, permissions: SubagentPermissions | null) => Promise<boolean>;
  /** Deletes a Personal agent's file. */
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation('settings');
  // The dialog keeps its name while it closes; its row is read live so a save shows in it.
  const [permissions, setPermissions] = useState<{ name: string; open: boolean } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const permissionsRow = permissions
    ? rows.find((row) => row.name === permissions.name)
    : undefined;

  return (
    <>
      <ExtensionGroup
        title={title}
        showTitle={showTitle}
        empty={empty}
        loading={loading}
        hasRows={items.length > 0}
        emptyIcon={<Bot />}
      >
        {items.map(({ row, description, match }) => (
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
              pending={busyId === row.name}
              onEnabledChange={(enabled) => onEnabled(row.name, enabled)}
              onDetails={() => onOpen(row.name)}
              lockedReason={lockedReason}
              menu={
                <>
                  <DropdownMenuItem onSelect={() => setPermissions({ name: row.name, open: true })}>
                    <Shield />
                    {t('extensions.agentPermissionsAction')}
                  </DropdownMenuItem>
                  {row.readOnly ? null : (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={!connected || busyId === row.name}
                        onSelect={() => setDeleting(row.name)}
                      >
                        <Trash2 />
                        {t('extensions.delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </>
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
          disabled={!connected}
          pending={busyId === permissionsRow.name}
          onSave={(value) => onPermissions(permissionsRow.name, value)}
        />
      ) : null}
      <ExtensionRemoveDialog
        name={deleting}
        title={t('extensions.deleteTitle', { name: deleting ?? '' })}
        description={t('extensions.deleteAgentDescription')}
        confirm={t('extensions.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={onDelete}
      />
    </>
  );
}
