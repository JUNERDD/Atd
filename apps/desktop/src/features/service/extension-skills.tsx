import { useState } from 'react';
import { BookOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@ai/ui/components/item';
import { Switch } from '@ai/ui/components/switch';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { IconButton } from '../../components/icon-button';
import { showToast } from '../../components/toast-store';
import { ExtensionGroup } from './extension-group';
import { RestoreBuiltinDialog, SkillBuiltinStatus } from './extension-skill-builtin';
import { SkillInstallForm } from './extension-skill-install-form';
import type { ExtensionSkillRow } from './use-service';

function sourceLabelKey(
  sourceKind: ExtensionSkillRow['sourceKind'],
):
  | 'extensions.sourceLocal'
  | 'extensions.sourceNpm'
  | 'extensions.sourceGit'
  | 'extensions.sourceAgents'
  | 'extensions.sourceAtd'
  | null {
  switch (sourceKind) {
    case 'local':
      return 'extensions.sourceLocal';
    case 'npm':
      return 'extensions.sourceNpm';
    case 'git':
      return 'extensions.sourceGit';
    case 'agents':
      return 'extensions.sourceAgents';
    case 'atd':
      return 'extensions.sourceAtd';
    case '':
      return null;
    default: {
      const _exhaustive: never = sourceKind;
      return _exhaustive;
    }
  }
}

/**
 * Skills catalog. Entries come from the service list, including ~/.agents/skills. The search
 * matches and marks the name and the description line as shown, with the translated source.
 * A built-in skill whose copy differs from the shipped one shows its state next to the name and
 * a restore action before the switch; the backup path of the last restore stays above the list,
 * since a toast only carries one short sentence.
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
    const sourceKey = row.system ? 'extensions.sourceSystem' : sourceLabelKey(row.sourceKind);
    const description = [row.description, sourceKey ? t(sourceKey) : '', row.revision]
      .filter(Boolean)
      .join(' · ');
    const match = matchFields(query, { name: row.name, description });
    return match || !query.trim() ? [{ row, description, match }] : [];
  });
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
        {shown.map(({ row, description, match }) => {
          const showUpdate = connected && row.sourceKind === 'local';
          const rowBusy = busyName === row.name;
          const builtin = row.builtin;
          const showRestore = builtin !== null && builtin.status !== 'current';
          return (
            <Item asChild key={row.name} size="xs" className="pl-0">
              <li>
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
                <ItemActions>
                  {showUpdate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rowBusy}
                      onClick={() => onUpdate(row.name)}
                    >
                      {t('extensions.updateSkill')}
                    </Button>
                  ) : null}
                  {showRestore ? (
                    <IconButton
                      label={t('extensions.restoreAction')}
                      aria-label={t('extensions.restoreActionFor', { name: row.name })}
                      disabled={!connected || rowBusy}
                      tooltipDismissOnClick
                      onClick={() => setRestoring({ id: builtin.id, name: row.name })}
                    >
                      <RotateCcw />
                    </IconButton>
                  ) : null}
                  <Switch
                    aria-label={t('extensions.enableSkill', { name: row.name })}
                    checked={row.enabled}
                    disabled={!connected}
                    onCheckedChange={(enabled) => onEnabled(row.name, enabled)}
                  />
                </ItemActions>
              </li>
            </Item>
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
