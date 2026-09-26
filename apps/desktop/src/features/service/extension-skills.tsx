import { useState } from 'react';
import { BookOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DropdownMenuItem } from '@ai/ui/components/dropdown-menu';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import { ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { showToast } from '../../components/toast-store';
import { ExtensionGroup } from './extension-group';
import { ExtensionRow, ExtensionRowActions } from './extension-row';
import { skillSourceLabelKey, type ExtensionSkillRow } from './extension-rows';
import { RestoreBuiltinDialog, SkillBuiltinStatus } from './extension-skill-builtin';
import { SkillDetailDialog } from './extension-skill-detail';
import { SkillInstallForm } from './extension-skill-install-form';

/**
 * Skills catalog. Entries come from the service list, including ~/.agents/skills. The search
 * matches and marks the name and the description line as shown, with the translated source.
 * A built-in skill whose copy differs from the shipped one shows its state next to the name and
 * offers a restore in its More menu, beside the details and a local skill's update; the backup
 * path of the last restore stays above the list, since a toast only carries one short sentence.
 */
export function ExtensionSkillsGroup({
  rows,
  query,
  loading,
  empty,
  connected,
  busyName,
  adding,
  formKey,
  busy,
  onClose,
  onInstall,
  onEnabled,
  onUpdate,
  onRestore,
}: {
  rows: ExtensionSkillRow[];
  query: string;
  loading: boolean;
  empty: string;
  connected: boolean;
  busyName: string | null;
  adding: boolean;
  formKey: number;
  busy: boolean;
  onClose: () => void;
  onInstall: (input: {
    source: string;
    sourceKind: 'local' | 'npm' | 'git';
    name?: string;
  }) => Promise<boolean>;
  onEnabled: (name: string, enabled: boolean) => void;
  onUpdate: (name: string) => void;
  /** Resolves to the backup path (null when nothing was backed up), or undefined on failure. */
  onRestore: (id: string) => Promise<{ backupPath: string | null } | undefined>;
}) {
  const { t } = useTranslation('settings');
  const [restoring, setRestoring] = useState<{ id: string; name: string } | null>(null);
  const [backup, setBackup] = useState<{ name: string; path: string } | null>(null);
  // The name stays while the dialog closes; the row is read live so a toggle shows in it.
  const [detail, setDetail] = useState<{ name: string; open: boolean } | null>(null);
  const detailRow = detail ? rows.find((row) => row.name === detail.name) : undefined;
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
  const form =
    adding && connected ? (
      <SkillInstallForm
        key={formKey}
        busy={busy}
        onCancel={onClose}
        onSave={(input) => {
          void onInstall(input).then((ok) => {
            if (ok) onClose();
          });
        }}
      />
    ) : null;
  const shown = rows.flatMap((row) => {
    const sourceKey = row.system ? 'extensions.sourceSystem' : skillSourceLabelKey(row.sourceKind);
    const description = [row.description, sourceKey ? t(sourceKey) : '', row.revision]
      .filter(Boolean)
      .join(' · ');
    const match = matchFields(query, { name: row.name, description });
    const showUpdate = connected && row.sourceKind === 'local';
    const showRestore = row.builtin !== null && row.builtin.status !== 'current';
    return match || !query.trim() ? [{ row, description, match, showUpdate, showRestore }] : [];
  });
  // Rows without More keep its column while another row shows it, so the switches line up.
  const anyMenu = shown.some((item) => item.showUpdate || item.showRestore);
  return (
    <>
      {form}
      <ExtensionGroup
        title={t('extensions.tabSkills')}
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={false}
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
            <ExtensionRow
              key={row.name}
              name={row.name}
              onDetails={() => setDetail({ name: row.name, open: true })}
            >
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
                onDetails={() => setDetail({ name: row.name, open: true })}
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
      {detailRow ? (
        <SkillDetailDialog
          row={detailRow}
          open={detail?.open ?? false}
          onOpenChange={(open) => setDetail({ name: detailRow.name, open })}
        />
      ) : null}
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
