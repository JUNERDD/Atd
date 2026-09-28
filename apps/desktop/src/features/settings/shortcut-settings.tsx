import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import type { SettingsSnapshot, ShortcutAction } from '../../../electron/settings-contract';
import { shortcutKeys } from '../../lib/shortcuts';
import { useShortcutSettings } from './use-shortcut-settings';

const IN_APP_SHORTCUTS = [
  {
    action: 'newConversation',
    labelKey: 'shortcuts.actions.newConversation.label',
    descriptionKey: 'shortcuts.actions.newConversation.description',
  },
  {
    action: 'openSettings',
    labelKey: 'shortcuts.actions.openSettings.label',
    descriptionKey: 'shortcuts.actions.openSettings.description',
  },
  {
    action: 'sendMessage',
    labelKey: 'shortcuts.actions.sendMessage.label',
    descriptionKey: 'shortcuts.actions.sendMessage.description',
  },
  {
    action: 'newLine',
    labelKey: 'shortcuts.actions.newLine.label',
    descriptionKey: 'shortcuts.actions.newLine.description',
  },
] as const;

/** A labeled desktop window preference switch in the page footer. */
function WindowPreference({
  id,
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  // The visible label names the switch; a tooltip repeating it would add nothing.
  return (
    <div className="settings-window-preference">
      <Label htmlFor={id}>{label}</Label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ShortcutRow({
  action,
  label,
  description,
  settings,
}: {
  action: ShortcutAction;
  label: string;
  description: string;
  settings: ReturnType<typeof useShortcutSettings>;
}) {
  const { t } = useTranslation('settings');
  const recording = settings.recording === action;
  const keys = shortcutKeys(settings.bindings[action], settings.platform);

  return (
    <Item asChild variant={action === 'togglePanel' ? 'outline' : 'default'} size="xs">
      <li>
        <ItemContent className="min-w-[min(120px,100%)]">
          <ItemTitle className="block max-w-full" title={label}>
            {label}
          </ItemTitle>
          <ItemDescription className="block" title={description}>
            {description}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="ghost"
            className="settings-shortcut-button"
            aria-label={
              recording
                ? t('shortcuts.capture.cancelLabel', { label })
                : t('shortcuts.capture.changeLabel', { label, keys: keys.join(' ') })
            }
            aria-describedby={recording ? 'settings-shortcut-hint' : undefined}
            aria-pressed={recording}
            disabled={
              settings.unavailable ||
              settings.pending !== null ||
              (settings.recording !== null && !recording)
            }
            onClick={() => {
              if (recording) settings.cancelRecording();
              else settings.startRecording(action);
            }}
            onBlur={() => {
              if (recording) settings.cancelRecording();
            }}
          >
            {recording ? (
              t('shortcuts.capture.pressKeys')
            ) : (
              <KbdGroup aria-hidden="true">
                {keys.map((key, index) => (
                  <Kbd key={`${index}-${key}`}>{key}</Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
        </ItemActions>
      </li>
    </Item>
  );
}

export function ShortcutSettings({
  snapshot,
  onRecordingChange,
}: {
  snapshot: SettingsSnapshot | null;
  onRecordingChange: (recording: boolean) => void;
}) {
  const { t } = useTranslation('settings');
  const settings = useShortcutSettings(snapshot);
  const desktopApp = window.desktop?.runtime === 'electron';
  const recording = settings.recording !== null;
  const preferenceDisabled = settings.unavailable || settings.pending !== null || recording;

  useEffect(() => {
    onRecordingChange(recording);
    return () => onRecordingChange(false);
  }, [onRecordingChange, recording]);

  return (
    <>
      <header className="settings-section-heading">
        <h2 title={t('shortcuts.title')}>{t('shortcuts.title')}</h2>
        <p title={t('shortcuts.description')}>{t('shortcuts.description')}</p>
      </header>
      <div className="settings-shortcut-groups" aria-busy={settings.pending !== null}>
        <section className="settings-shortcut-group" aria-labelledby="settings-global-shortcuts">
          <h3 id="settings-global-shortcuts">{t('shortcuts.groups.global')}</h3>
          <ItemGroup>
            <ShortcutRow
              action="togglePanel"
              label={t('shortcuts.actions.togglePanel.label')}
              description={t('shortcuts.actions.togglePanel.description')}
              settings={settings}
            />
          </ItemGroup>
          {!desktopApp ? (
            <p className="settings-status">{t('shortcuts.registeredByDesktop')}</p>
          ) : (
            snapshot?.shortcutAvailable === false && (
              <p className="settings-status" data-error="true" role="alert">
                {t('shortcuts.errors.register')}
              </p>
            )
          )}
        </section>
        <section className="settings-shortcut-group" aria-labelledby="settings-in-app-shortcuts">
          <h3 id="settings-in-app-shortcuts">{t('shortcuts.groups.inApp')}</h3>
          <ItemGroup>
            {IN_APP_SHORTCUTS.map(({ action, labelKey, descriptionKey }) => (
              <ShortcutRow
                key={action}
                action={action}
                label={t(labelKey)}
                description={t(descriptionKey)}
                settings={settings}
              />
            ))}
          </ItemGroup>
        </section>
      </div>

      <div className="settings-shortcuts-footer">
        {/* Window preferences belong to the desktop app; a browser tab has none. */}
        {desktopApp && (
          <div className="settings-window-preferences">
            {/* Null where the OS login item is unavailable: development builds and Linux. */}
            {settings.openAtLogin !== null && (
              <WindowPreference
                id="settings-open-at-login"
                label={t('shortcuts.openAtLogin')}
                checked={settings.openAtLogin}
                disabled={preferenceDisabled}
                onCheckedChange={(value) => void settings.changeOpenAtLogin(value)}
              />
            )}
            {/* macOS keeps the menu bar status item either way, so the panel stays reachable. */}
            {settings.platform === 'darwin' && (
              <WindowPreference
                id="settings-show-in-dock"
                label={t('shortcuts.showInDock')}
                checked={settings.showInDock}
                disabled={preferenceDisabled}
                onCheckedChange={(value) => void settings.changeShowInDock(value)}
              />
            )}
            <WindowPreference
              id="settings-always-on-top"
              label={t('shortcuts.alwaysOnTop')}
              checked={settings.pinned}
              disabled={preferenceDisabled}
              onCheckedChange={(value) => void settings.changePinned(value)}
            />
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          // Stays at the trailing edge when the window preferences are absent (web client).
          className="ml-auto"
          disabled={preferenceDisabled}
          onClick={() => void settings.restoreDefaults()}
        >
          {settings.pending === 'restore'
            ? t('shortcuts.restoring')
            : t('shortcuts.restoreDefaults')}
        </Button>
      </div>
      {/* Read with the recording button, which itself only shows Press keys. */}
      <p id="settings-shortcut-hint" className="sr-only">
        {t('shortcuts.status.recordingHint')}
      </p>
    </>
  );
}
