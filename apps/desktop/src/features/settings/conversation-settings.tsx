import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import {
  DEFAULT_VIEW_INITIATIVE,
  VIEW_INITIATIVES,
  isViewInitiative,
  type SettingsSnapshot,
  type ViewInitiative,
} from '../../client/settings-contract';
import { useSettingsSectionExit } from './settings-navigation';
import { SummaryTitlesRow } from './summary-titles-row';

/**
 * How readily the agent shows interactive views, one of `VIEW_INITIATIVES`, with a sentence about
 * the selected level. It saves on its own with its own pending state and error, which leaving the
 * section clears, and the select wraps below the text at narrow widths, like the other settings
 * rows' actions. Runs that start after a change use the new level.
 */
function ViewInitiativeRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const descriptionId = useId();
  const setViewInitiative = window.desktop?.settings.setViewInitiative;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));
  const unavailable = !snapshot || !setViewInitiative;
  const level = snapshot?.viewInitiative ?? DEFAULT_VIEW_INITIATIVE;

  async function change(next: ViewInitiative) {
    if (!setViewInitiative || pending) return;
    setError(undefined);
    setPending(true);
    try {
      await setViewInitiative(next);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : t('shortcuts.viewInitiative.saveFailed'),
      );
    }
    setPending(false);
  }

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor="settings-view-initiative">
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{t('shortcuts.viewInitiative.title')}</ItemTitle>
          <ItemDescription id={descriptionId} className="whitespace-normal">
            {t(`shortcuts.viewInitiative.hints.${level}`)}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={level}
            disabled={unavailable}
            onValueChange={(value) => {
              if (isViewInitiative(value)) void change(value);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('shortcuts.viewInitiative.label')}
              aria-describedby={descriptionId}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VIEW_INITIATIVES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`shortcuts.viewInitiative.modes.${mode}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ItemActions>
        {error && (
          <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
            <CircleAlert aria-hidden="true" />
            <span>{error}</span>
          </ItemFooter>
        )}
      </li>
    </Item>
  );
}

/** Agent › Conversation: preferences for how the agent behaves in a conversation. */
export function ConversationSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-conversation-group">
      <h3 id="settings-conversation-group" className="settings-section-title">
        {t('shortcuts.groups.conversation')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SummaryTitlesRow snapshot={snapshot} />
          <ViewInitiativeRow snapshot={snapshot} />
        </ItemGroup>
      </Card>
    </section>
  );
}
