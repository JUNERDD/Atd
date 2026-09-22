import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '@ai/ui/components/item';
import { Switch } from '@ai/ui/components/switch';
import { ExtensionGroup } from './extension-group';
import type { ExtensionSkillRow } from './use-service';

function sourceLabelKey(
  sourceKind: ExtensionSkillRow['sourceKind'],
):
  | 'extensions.sourceLocal'
  | 'extensions.sourceNpm'
  | 'extensions.sourceGit'
  | 'extensions.sourceAgents'
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
    case '':
      return null;
    default: {
      const _exhaustive: never = sourceKind;
      return _exhaustive;
    }
  }
}

/** Skills catalog. Entries come from the service list, including ~/.agents/skills. */
export function ExtensionSkillsGroup({
  rows,
  loading,
  empty,
  connected,
  busyName,
  onEnabled,
  onUpdate,
}: {
  rows: ExtensionSkillRow[];
  loading: boolean;
  empty: string;
  connected: boolean;
  busyName: string | null;
  onEnabled: (name: string, enabled: boolean) => void;
  onUpdate: (name: string) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <ExtensionGroup
      title={t('extensions.tabSkills')}
      note=""
      empty={empty}
      loading={loading}
      hasRows={rows.length > 0}
      showTitle={false}
      emptyIcon={<BookOpen />}
    >
      {rows.map((row) => {
        const sourceKey = sourceLabelKey(row.sourceKind);
        const description = [row.description, sourceKey ? t(sourceKey) : '', row.revision]
          .filter(Boolean)
          .join(' · ');
        const showUpdate = connected && row.sourceKind === 'local';
        const rowBusy = busyName === row.name;
        return (
          <Item asChild key={row.name} size="xs">
            <li>
              <ItemMedia variant="icon">
                <BookOpen />
              </ItemMedia>
              <ItemContent>
                <ItemTitle title={row.name}>{row.name}</ItemTitle>
                {description ? (
                  <ItemDescription title={description}>{description}</ItemDescription>
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
  );
}
