import { useState } from 'react';
import { BookOpen, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenuItem } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { showToast } from '../../components/toast-store';
import { ExtensionGroup } from './extension-group';
import { ExtensionRemoveDialog } from './extension-remove-dialog';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import { RestoreBuiltinDialog, SkillBuiltinStatus } from './extension-skill-builtin';
import type { SkillMatch } from './use-extension-matches';

/**
 * One plugin's skills, on its page or among search results (`useExtensionMatches` marks the name
 * and the description line). A built-in skill whose copy differs from the shipped one shows its
 * state next to the name and offers a restore in its More menu; the backup path of the last
 * restore stays above the list, since a toast only carries one short sentence. A Personal skill
 * (not read-only) offers Delete, which removes its files after a confirmation; updates and removal
 * of other skills belong to their plugin. A row click and More › View details both open the
 * skill's details page (`onOpen`).
 */
export function ExtensionSkillsGroup({
  title,
  showTitle = true,
  items,
  loading,
  empty,
  connected,
  busyId,
  lockedReason,
  onOpen,
  onEnabled,
  onRestore,
  onDelete,
}: {
  title: string;
  /** False when a tab names the kind; the section keeps its name for accessibility. */
  showTitle?: boolean;
  items: SkillMatch[];
  loading: boolean;
  empty: string;
  connected: boolean;
  /** The built-in id (`skill:<name>`) a restore, or the skill name a delete, is running for. */
  busyId: string | null;
  /** Why the switches are locked (their plugin is off); null when they are not. */
  lockedReason: string | null;
  onOpen: (name: string) => void;
  onEnabled: (name: string, enabled: boolean) => void;
  /** Resolves to the backup path (null when nothing was backed up), or undefined on failure. */
  onRestore: (id: string) => Promise<{ backupPath: string | null } | undefined>;
  /** Deletes a Personal skill's files. */
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation('settings');
  const [restoring, setRestoring] = useState<{ id: string; name: string } | null>(null);
  const [backup, setBackup] = useState<{ name: string; path: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
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
  return (
    <>
      <ExtensionGroup
        title={title}
        showTitle={showTitle}
        empty={empty}
        loading={loading}
        hasRows={items.length > 0}
        emptyIcon={<BookOpen />}
        status={
          backup ? (
            <output className="settings-status">
              {t('extensions.restoreBackupPath', { name: backup.name, path: backup.path })}
            </output>
          ) : null
        }
      >
        {items.map(({ row, description, match }) => {
          const builtin = row.builtin;
          const showRestore = builtin !== null && builtin.status !== 'current';
          const rowBusy = busyId === (builtin ? builtin.id : row.name);
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
                lockedReason={lockedReason}
                menu={
                  showRestore || !row.readOnly ? (
                    <>
                      {builtin && showRestore ? (
                        <DropdownMenuItem
                          disabled={!connected || rowBusy}
                          onSelect={() => setRestoring({ id: builtin.id, name: row.name })}
                        >
                          <RotateCcw />
                          {t('extensions.restoreAction')}
                        </DropdownMenuItem>
                      ) : null}
                      {row.readOnly ? null : (
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={!connected || rowBusy}
                          onSelect={() => setDeleting(row.name)}
                        >
                          <Trash2 />
                          {t('extensions.delete')}
                        </DropdownMenuItem>
                      )}
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
      <ExtensionRemoveDialog
        name={deleting}
        title={t('extensions.deleteTitle', { name: deleting ?? '' })}
        description={t('extensions.deleteSkillDescription')}
        confirm={t('extensions.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={onDelete}
      />
    </>
  );
}
