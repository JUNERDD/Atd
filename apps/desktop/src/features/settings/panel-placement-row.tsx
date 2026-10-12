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
  PANEL_PLACEMENTS,
  type PanelPlacement,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { useSettingsSectionExit } from './settings-navigation';

function isPlacement(value: string): value is PanelPlacement {
  return (PANEL_PLACEMENTS as readonly string[]).includes(value);
}

/**
 * General › Window: where a summon shows the task panel, a choice the shell keeps. It waits for
 * the shell's report (`app.state`), showing the default meanwhile, and saves on its own with its
 * own pending state and error, which leaving the section clears, like the other window
 * preferences. A change applies from the next summon. The select wraps below the text at narrow
 * widths, like the other settings rows' actions.
 */
export function PanelPlacementRow({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const desktop = window.desktop;
  const setPlacement = desktop?.setPanelPlacement;
  const reported = setPlacement ? (snapshot?.panelPlacement ?? null) : null;
  const placement = reported ?? 'bottomRight';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));
  const unavailable = !snapshot || !desktop?.settings || reported === null;

  async function change(value: PanelPlacement) {
    if (!setPlacement || pending) return;
    setError(undefined);
    setPending(true);
    try {
      await setPlacement(value);
    } catch (reason) {
      setError(
        reason instanceof Error && reason.message
          ? reason.message
          : t('shortcuts.errors.windowPreferenceSave'),
      );
    }
    setPending(false);
  }

  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor="settings-panel-placement">
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{t('shortcuts.panelPlacement.title')}</ItemTitle>
          <ItemDescription className="whitespace-normal">
            {t('shortcuts.panelPlacement.description')}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={placement}
            disabled={unavailable}
            onValueChange={(value) => {
              if (isPlacement(value)) void change(value);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('shortcuts.panelPlacement.label')}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PANEL_PLACEMENTS.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`shortcuts.panelPlacement.modes.${mode}`)}
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
