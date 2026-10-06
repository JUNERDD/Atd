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
import { MINI_PANEL_OPEN_ON, type MiniPanelOpenOn } from '../../client/settings-contract';
import type { useShortcutSettings } from './use-shortcut-settings';

function isOpenOn(value: string): value is MiniPanelOpenOn {
  return (MINI_PANEL_OPEN_ON as readonly string[]).includes(value);
}

/**
 * General › Window: how the mini panel opens from its pill, as the pointer reaches it or only on a
 * click, with a description of the chosen behavior. Like the mini panel's switch it waits for the
 * shell's first report, showing the default meanwhile; it stays available while the panel is
 * hidden, for the next time it shows. The select wraps below the text at narrow widths, like the
 * other settings rows' actions.
 */
export function MiniPanelOpenRow({
  settings,
}: {
  settings: ReturnType<typeof useShortcutSettings>;
}) {
  const { t } = useTranslation('settings');
  const openOn = settings.miniPanelOpenOn ?? 'click';
  const pending = settings.preferencePending.miniPanelOpenOn === true;
  const error = settings.errors.miniPanelOpenOn;
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor="settings-mini-panel-open">
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">
            {t('shortcuts.miniPanelOpenOn.title')}
          </ItemTitle>
          <ItemDescription className="whitespace-normal">
            {t(`shortcuts.miniPanelOpenOn.hints.${openOn}`)}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto flex-wrap justify-end">
          <Select
            value={openOn}
            disabled={settings.unavailable || settings.miniPanelOpenOn === null}
            onValueChange={(value) => {
              if (!pending && isOpenOn(value)) void settings.changeMiniPanelOpenOn(value);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('shortcuts.miniPanelOpenOn.label')}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MINI_PANEL_OPEN_ON.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {t(`shortcuts.miniPanelOpenOn.modes.${mode}`)}
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
