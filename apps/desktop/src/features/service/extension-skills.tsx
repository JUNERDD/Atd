import { useState } from 'react';
import { BookOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenuItem } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { showToast } from '../../components/toast-store';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import { RestoreBuiltinDialog, SkillBuiltinStatus } from './extension-skill-builtin';
import type { SkillMatch } from './use-extension-matches';

/**
 * Skills catalog. Entries come from the service list, including ~/.agents/skills, already
 * filtered by the search (`useExtensionMatches`), which marks the name and the description line.
 * A built-in skill whose copy differs from the shipped one shows its state next to the name and
 * offers a restore in its More menu, beside the details and a local skill's update; the backup
 * path of the last restore stays above the list, since a toast only carries one short sentence.
 * A row click and More › View details both open the skill's details page (`onOpen`).
 */
export function ExtensionSkillsGroup({
  items,
  showTitle,
  reserveMenu,
  loading,
  empty,
  connected,
  busyName,
  onOpen,
  onEnabled,
  onUpdate,
  onRestore,
}: {
  items: SkillMatch[];
  /** Search results list every catalog at once, so each group names itself. */
  showTitle: boolean;
  /** Keeps More's column when rows listed beside this group show it, as search results do. */
  reserveMenu: boolean;
  loading: boolean;
  empty: string;
  connected: boolean;
  busyName: string | null;
  onOpen: (name: string) => void;
  onEnabled: (name: string, enabled: boolean) => void;
  onUpdate: (name: string) => void;
  /** Resolves to the backup path (null when nothing was backed up), or undefined on failure. */
  onRestore: (id: string) => Promise<{ backupPath: string | null } | undefined>;
}) {
  const { t } = useTranslation('settings');
  const [restoring, setRestoring] = useState<{ id: string; name: string } | null>(null);
  const [backup, setBackup] = useState<{ name: string; path: string } | null>(null);
  function restore(target: { id: string; name: string }) {
    void onRestore(target.id).then((result) => {
      if (!result) {
        showToast({ kind: 'error', text: t('extensions.restoreFailed', { name: target.name }) });
        return;
      }
      const { backupPath } = result;
      setBackup(backupPath === null ? null : { name: target.name, path: backupPath });
      showToast({
        kind: 'info',
        text:
          backupPath === null
            ? t('extensions.restoreDoneNoBackup', { name: target.name })
            : t('extensions.restoreDone', { name: target.name }),
      });
    });
  }
  const shown = items.map((item) => ({
    ...item,
    showUpdate: connected && item.row.sourceKind === 'local',
    showRestore: item.row.builtin !== null && item.row.builtin.status !== 'current',
  }));
  // Rows without More keep its column while another row shows it, so the switches line up.
  const anyMenu = reserveMenu || shown.some((item) => item.showUpdate || item.showRestore);
  return (
    <>
      <ExtensionGroup
        title={t('extensions.tabSkills')}
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={showTitle}
        emptyIcon={<BookOpen />}
        status={
          backup ? (
            <output className="settings-status">
              {t('extensions.restoreBackupPath', { name: backup.name, path: backup.path })}
            </output>
          ) : null
        }
      >
        {shown.map(({ row, description, match, showUpdate, showRestore }) => {
          const rowBusy = busyName === row.name;
          const builtin = row.builtin;
          return (
            <ExtensionRow key={row.name} name={row.name} onDetails={() => onOpen(row.name)}>
              <ItemMedia variant="icon">
                <BookOpen />
              </ItemMedia>
              <ItemContent>
                <div className="flex min-w-0 items-center gap-2">
                  <ItemTitle title={row.name}>
                    <HighlightedText text={row.name} ranges={match?.ranges.name} />
                  </ItemTitle>
                  {builtin ? <SkillBuiltinStatus status={builtin.status} /> : null}
                </div>
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
                reserveMenu={anyMenu}
                menu={
                  showUpdate || showRestore ? (
                    <>
                      {showUpdate ? (
                        <DropdownMenuItem disabled={rowBusy} onSelect={() => onUpdate(row.name)}>
                          <RefreshCw />
                          {t('extensions.updateSkill')}
                        </DropdownMenuItem>
                      ) : null}
                      {builtin && showRestore ? (
                        <DropdownMenuItem
                          disabled={!connected || rowBusy}
                          onSelect={() => setRestoring({ id: builtin.id, name: row.name })}
                        >
                          <RotateCcw />
                          {t('extensions.restoreAction')}
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  ) : null
                }
              />
            </ExtensionRow>
          );
        })}
      </ExtensionGroup>
      <RestoreBuiltinDialog
        name={restoring?.name ?? null}
        onCancel={() => setRestoring(null)}
        onConfirm={() => {
          if (restoring) restore(restoring);
        }}
      />
    </>
  );
}
