import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { SelectionToolbarSettings } from './selection-toolbar-settings';
import { SettingsHeading } from './settings-heading';
import { SettingsSwitchRow } from './settings-switch-row';
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

export function GeneralSettings({
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
  const panelFailed = desktopApp && snapshot?.shortcutAvailable === false;
  const screenshotFailed = desktopApp && snapshot?.screenshotShortcutAvailable === false;
  const restoring = settings.shortcutBusy === 'all';
  const restoreUnavailable = settings.shortcutBusy !== null || settings.allDefault;

  useEffect(() => {
    onRecordingChange(recording);
    return () => onRecordingChange(false);
  }, [onRecordingChange, recording]);

  return (
    <>
      <SettingsHeading title={t('general.title')} description={t('general.description')} />
      <div className="settings-shortcut-groups">
        <section className="settings-shortcut-group" aria-labelledby="settings-global-shortcuts">
          <h3 id="settings-global-shortcuts" className="settings-section-title">
            {t('shortcuts.groups.global')}
          </h3>
          <Card size="sm" className="settings-card">
            <ItemGroup>
              <ShortcutRow
                action="togglePanel"
                label={t('shortcuts.actions.togglePanel.label')}
                description={t('shortcuts.actions.togglePanel.description')}
                settings={settings}
                error={panelFailed ? t('shortcuts.errors.register') : undefined}
              />
              <ShortcutRow
                action="captureScreenshot"
                label={t('shortcuts.actions.captureScreenshot.label')}
                description={t('shortcuts.actions.captureScreenshot.description')}
                settings={settings}
                error={screenshotFailed ? t('shortcuts.errors.register') : undefined}
              />
            </ItemGroup>
          </Card>
          {/* Only global shortcuts can collide with another app's; an error says it itself. */}
          {!panelFailed && !screenshotFailed && <ShortcutConflictHint />}
        </section>
        <section className="settings-shortcut-group" aria-labelledby="settings-in-app-shortcuts">
          <h3 id="settings-in-app-shortcuts" className="settings-section-title">
            {t('shortcuts.groups.inApp')}
          </h3>
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
        </section>
        {/* Window preferences belong to the desktop app; a browser tab has none. */}
        {desktopApp && (
          <section className="settings-shortcut-group" aria-labelledby="settings-window-group">
            <h3 id="settings-window-group" className="settings-section-title">
              {t('shortcuts.groups.window')}
            </h3>
            <Card size="sm" className="settings-card">
              <ItemGroup>
                {/* Null where the OS login item is unavailable: development builds and Linux. */}
                {settings.openAtLogin !== null && (
                  <SettingsSwitchRow
                    id="settings-open-at-login"
                    anchor="settings-open-at-login"
                    title={t('shortcuts.openAtLogin')}
                    description={t('shortcuts.preferenceNotes.openAtLogin')}
                    checked={settings.openAtLogin}
                    disabled={settings.unavailable}
                    pending={settings.preferencePending.login}
                    note={
                      settings.errors.login ??
                      (settings.loginApprovalNeeded
                        ? t('shortcuts.status.openAtLoginApproval')
                        : undefined)
                    }
                    onCheckedChange={(value) => void settings.changeOpenAtLogin(value)}
                  />
                )}
                {/* macOS keeps the menu bar status item either way, so the panel stays reachable. */}
                {settings.platform === 'darwin' && (
                  <SettingsSwitchRow
                    id="settings-show-in-dock"
                    anchor="settings-show-in-dock"
                    title={t('shortcuts.showInDock')}
                    description={t('shortcuts.preferenceNotes.showInDock')}
                    checked={settings.showInDock}
                    disabled={settings.unavailable}
                    pending={settings.preferencePending.dock}
                    note={settings.errors.dock}
                    onCheckedChange={(value) => void settings.changeShowInDock(value)}
                  />
                )}
                <SettingsSwitchRow
                  id="settings-always-on-top"
                  anchor="settings-always-on-top"
                  title={t('shortcuts.alwaysOnTop')}
                  description={t('shortcuts.preferenceNotes.alwaysOnTop')}
                  checked={settings.pinned}
                  disabled={settings.unavailable}
                  pending={settings.preferencePending.pin}
                  note={settings.errors.pin}
                  onCheckedChange={(value) => void settings.changePinned(value)}
                />
              </ItemGroup>
            </Card>
          </section>
        )}
        {/* The toolbar over other apps' selected text is the desktop app's, like its window. */}
        {desktopApp && <SelectionToolbarSettings snapshot={snapshot} />}
        {/* Restores the global shortcut as well as the in-app ones, so it follows every group. */}
        <div className="settings-shortcut-restore">
          {settings.errors.restore && (
            <p id="settings-shortcut-restore-error" className="settings-inline-error" role="alert">
              <CircleAlert aria-hidden="true" />
              <span>{settings.errors.restore}</span>
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="aria-disabled:opacity-50"
            data-settings-anchor="shortcuts-restore-defaults"
            disabled={settings.unavailable}
            // Stays focusable once everything is default again, so focus does not drop away.
            aria-disabled={restoreUnavailable || undefined}
            aria-busy={restoring || undefined}
            aria-describedby={
              settings.errors.restore ? 'settings-shortcut-restore-error' : undefined
            }
            onClick={settings.restoreDefaults}
          >
            {restoring ? t('shortcuts.restoring') : t('shortcuts.restoreDefaults')}
          </Button>
        </div>
      </div>
    </>
  );
}
