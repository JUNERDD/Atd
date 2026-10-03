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
  SELECTION_TOOLBAR_ACTIVATIONS,
  type SelectionToolbarActivation,
} from '../../client/settings-contract';
import { ShortcutRecorder } from '../../components/shortcut-recorder';
import { shortcutKeys } from '../../lib/shortcuts';
import { SettingsSwitchRow } from './settings-switch-row';
import {
  activationAccelerator,
  type useSelectionToolbarSettings,
} from './use-selection-toolbar-settings';

function isActivation(value: string): value is SelectionToolbarActivation {
  return (SELECTION_TOOLBAR_ACTIVATIONS as readonly string[]).includes(value);
}

/**
 * The selection toolbar's activation rows, shared by Settings and the welcome guide: which
 * selections bring it up (any, one made while the key combination is held, or any while pressing
 * the combination twice has switched it on), the combination itself in the app's shortcut recorder
 * (only the last two use it), and in the `toggle` mode the switch for the status HUD. The
 * description spells out the chosen behavior with the chosen keys. The controls wrap below the
 * text at narrow widths, like the other settings rows' actions. `compact` (the welcome guide,
 * whose step description already says what the keys do) keeps to one line: no description, and
 * the HUD switch stays in Settings.
 */
export function SelectionToolbarActivationRows({
  settings,
  compact = false,
}: {
  settings: ReturnType<typeof useSelectionToolbarSettings>;
  compact?: boolean;
}) {
  const { t } = useTranslation('settings');
  const { activation, activationKeys, showHud } = settings.value;
  const platform = window.desktop?.platform ?? 'web';
  const keys = shortcutKeys(activationAccelerator(activationKeys), platform);
  const label = t('selectionToolbar.activation.keysLabel');
  const error = settings.errors.activation;
  return (
    <>
      <Item asChild size="sm" className="settings-card-row">
        <li data-settings-anchor="settings-selection-toolbar-activation">
          {/* Wide enough that the controls wrap below a long description in a narrow column. */}
          <ItemContent className={compact ? 'min-w-0' : 'min-w-[min(200px,100%)]'}>
            <ItemTitle className="whitespace-normal">
              {t('selectionToolbar.activation.title')}
            </ItemTitle>
            {!compact && (
              <ItemDescription className="whitespace-normal">
                {t(`selectionToolbar.activation.hints.${activation}`, { keys: keys.join('') })}
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions className="ml-auto flex-wrap justify-end">
            <Select
              value={activation}
              disabled={settings.unavailable}
              onValueChange={(value) => {
                if (!settings.pending && isActivation(value)) settings.setActivation(value);
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={t('selectionToolbar.activation.modeLabel')}
                aria-busy={settings.pending || undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SELECTION_TOOLBAR_ACTIVATIONS.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`selectionToolbar.activation.modes.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {activation !== 'always' && (
              <ShortcutRecorder
                keys={keys}
                recording={settings.recordingKeys}
                aria-label={
                  settings.recordingKeys
                    ? t('shortcuts.capture.cancelLabel', { label })
                    : t('shortcuts.capture.changeLabel', { label, keys: keys.join(' ') })
                }
                disabled={settings.unavailable}
                aria-disabled={settings.pending || undefined}
                onClick={settings.toggleRecording}
                onBlur={() => {
                  if (settings.recordingKeys) settings.cancelRecording();
                }}
              />
            )}
          </ItemActions>
          {error && (
            <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
              <CircleAlert aria-hidden="true" />
              <span>{error}</span>
            </ItemFooter>
          )}
        </li>
      </Item>
      {activation === 'toggle' && !compact && (
        <SettingsSwitchRow
          id="settings-selection-toolbar-hud"
          anchor="settings-selection-toolbar-hud"
          title={t('selectionToolbar.hud.title')}
          description={t('selectionToolbar.hud.description')}
          checked={showHud}
          disabled={settings.unavailable}
          pending={settings.pending}
          note={settings.errors.hud}
          onCheckedChange={settings.setShowHud}
        />
      )}
    </>
  );
}
