import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
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
  APP_APPEARANCES,
  isAppAppearance,
  type AppAppearance,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { useSettingsSectionExit } from './settings-navigation';

/** The select's value for "follow the system", which the stored setting spells as null. */
const SYSTEM = 'system';
const OPTIONS = [SYSTEM, ...APP_APPEARANCES] as const;

/**
 * General › Appearance: the color scheme, following the system until the user pins light or dark.
 * It saves on its own with its own pending state and error, which leaving the section clears; the
 * select wraps below the text at narrow widths, like the other settings rows' actions.
 */
export function AppearanceRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const setAppearance = window.desktop?.settings.setAppearance;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));
  const unavailable = !snapshot || !setAppearance;

  async function change(appearance: AppAppearance | null) {
    if (!setAppearance || pending) return;
    setError(undefined);
    setPending(true);
    try {
      await setAppearance(appearance);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : t('shortcuts.appearance.saveFailed'),
      );
    }
    setPending(false);
  }

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor="settings-appearance">
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{t('shortcuts.appearance.title')}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {t('shortcuts.appearance.description')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={snapshot?.appearance ?? SYSTEM}
            disabled={unavailable}
            onValueChange={(value) => {
              if (value === SYSTEM) void change(null);
              else if (isAppAppearance(value)) void change(value);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('shortcuts.appearance.label')}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPTIONS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`shortcuts.appearance.modes.${mode}`)}
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
