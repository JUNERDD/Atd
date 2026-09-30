import { useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Card } from '@ai/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import { Label } from '@ai/ui/components/label';
import { Switch } from '@ai/ui/components/switch';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { SettingsHeading } from './settings-heading';
import { ShortcutConflictHint } from './shortcut-conflict-hint';
import { ShortcutRow } from './shortcut-row';
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

/**
 * A desktop window preference in the shortcut rows' anatomy, its switch in their action column.
 * The whole row toggles it; the switch is named by the title alone and described by the note.
 */
function WindowPreference({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (value: boolean) => void;
}) {
  const ids = useId();
  return (
    <Item asChild size="sm" className="settings-card-row settings-preference-row">
      <li data-settings-anchor={id}>
        <Label htmlFor={id} className="min-w-[min(120px,100%)] flex-1">
          <ItemContent>
            <ItemTitle id={`${ids}-title`}>{label}</ItemTitle>
            <ItemDescription id={`${ids}-description`} className="whitespace-normal">
              {description}
            </ItemDescription>
          </ItemContent>
        </Label>
        <ItemActions className="ml-auto">
          <Switch
            id={id}
            aria-labelledby={`${ids}-title`}
            aria-describedby={`${ids}-description`}
            checked={checked}
            disabled={disabled}
            onCheckedChange={onCheckedChange}
          />
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
  // Only the desktop app registers global shortcuts and owns window preferences.
  const desktopApp = window.desktop !== undefined;
  const recording = settings.recording !== null;
  const preferenceDisabled = settings.unavailable || settings.pending !== null || recording;
  const registerFailed = desktopApp && snapshot?.shortcutAvailable === false;

  useEffect(() => {
    onRecordingChange(recording);
    return () => onRecordingChange(false);
  }, [onRecordingChange, recording]);

  return (
    <>
      <SettingsHeading title={t('shortcuts.title')} description={t('shortcuts.description')} />
      <div className="settings-shortcut-groups" aria-busy={settings.pending !== null}>
        <section className="settings-shortcut-group" aria-labelledby="settings-global-shortcuts">
          <h3 id="settings-global-shortcuts">{t('shortcuts.groups.global')}</h3>
          <Card size="sm" className="settings-card">
            <ItemGroup>
              <ShortcutRow
                action="togglePanel"
                label={t('shortcuts.actions.togglePanel.label')}
                description={t('shortcuts.actions.togglePanel.description')}
                settings={settings}
                error={registerFailed ? t('shortcuts.errors.register') : undefined}
              />
            </ItemGroup>
          </Card>
          {/* Only the global shortcut can collide with another app's; the error says it itself. */}
          {!registerFailed && <ShortcutConflictHint />}
        </section>
        <section className="settings-shortcut-group" aria-labelledby="settings-in-app-shortcuts">
          <h3 id="settings-in-app-shortcuts">{t('shortcuts.groups.inApp')}</h3>
          <Card size="sm" className="settings-card">
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
          </Card>
          <div className="settings-shortcut-group-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-settings-anchor="shortcuts-restore-defaults"
              disabled={preferenceDisabled || settings.allDefault}
              onClick={() => void settings.restoreDefaults()}
            >
              {settings.pending === 'restore'
                ? t('shortcuts.restoring')
                : t('shortcuts.restoreDefaults')}
            </Button>
          </div>
        </section>
        {/* Window preferences belong to the desktop app; a browser tab has none. */}
        {desktopApp && (
          <section className="settings-shortcut-group" aria-labelledby="settings-window-group">
            <h3 id="settings-window-group">{t('shortcuts.groups.window')}</h3>
            <Card size="sm" className="settings-card">
              <ItemGroup>
                {/* Null where the OS login item is unavailable: development builds and Linux. */}
                {settings.openAtLogin !== null && (
                  <WindowPreference
                    id="settings-open-at-login"
                    label={t('shortcuts.openAtLogin')}
                    description={t('shortcuts.preferenceNotes.openAtLogin')}
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
                    description={t('shortcuts.preferenceNotes.showInDock')}
                    checked={settings.showInDock}
                    disabled={preferenceDisabled}
                    onCheckedChange={(value) => void settings.changeShowInDock(value)}
                  />
                )}
                <WindowPreference
                  id="settings-always-on-top"
                  label={t('shortcuts.alwaysOnTop')}
                  description={t('shortcuts.preferenceNotes.alwaysOnTop')}
                  checked={settings.pinned}
                  disabled={preferenceDisabled}
                  onCheckedChange={(value) => void settings.changePinned(value)}
                />
              </ItemGroup>
            </Card>
          </section>
        )}
      </div>
      {/* Read with the recording button, which itself only shows Press keys. */}
      <p id="settings-shortcut-hint" className="sr-only">
        {t('shortcuts.status.recordingHint')}
      </p>
    </>
  );
}
