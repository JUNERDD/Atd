import { BookOpen } from 'lucide-react';
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
import { ExtensionGroup } from './extension-group';
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
}) {
  const { t } = useTranslation('settings');
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
    const sourceKey = sourceLabelKey(row.sourceKind);
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
        note=""
        empty={empty}
        loading={loading}
        hasRows={shown.length > 0}
        showTitle={false}
        emptyIcon={<BookOpen />}
      >
        {shown.map(({ row, description, match }) => {
          const showUpdate = connected && row.sourceKind === 'local';
          const rowBusy = busyName === row.name;
          return (
            <Item asChild key={row.name} size="xs" className="pl-0">
              <li>
                <ItemMedia variant="icon">
                  <BookOpen />
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
    </>
  );
}
