import { useTranslation } from 'react-i18next';
import { BellOff, CircleAlert } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@atd/ui/components/item';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@atd/ui/components/select';
import { TASK_FINISHED_NOTIFY, type TaskFinishedNotify } from '../../client/notifications-contract';
import { SettingsSwitchRow } from './settings-switch-row';
import { useNotificationSettings } from './use-notification-settings';

function isFinishedChoice(value: string): value is TaskFinishedNotify {
  return (TASK_FINISHED_NOTIFY as readonly string[]).includes(value);
}

/**
 * General › Notifications: when a finished or failed task notifies, whether a question or approval
 * waiting for the person does, the sound and the previews (which automations' notifications follow
 * too), and, while the system denies notifications, why nothing arrives with the way to System
 * Settings. Rows wrap their actions below the text at narrow widths, like the other settings rows.
 */
export function NotificationSettings() {
  const { t } = useTranslation('settings');
  const settings = useNotificationSettings();
  const { preferences } = settings;
  const finishedError = settings.errorFor('finished');
  const permissionError = settings.errorFor('permission');
  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-notifications-group">
      <h3 id="settings-notifications-group" className="settings-section-title">
        {t('notifications.title')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <Item asChild size="sm" className="settings-card-row">
            <li data-settings-anchor="settings-notifications-finished">
              {/* Wide enough that the select wraps below a long description in a narrow column. */}
              <ItemContent className="min-w-[min(200px,100%)]">
                <ItemTitle className="whitespace-normal">
                  {t('notifications.finished.title')}
                </ItemTitle>
                <ItemDescription className="whitespace-normal">
                  {t('notifications.finished.description')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto flex-wrap justify-end">
                <Select
                  value={preferences.finished}
                  disabled={settings.unavailable}
                  onValueChange={(value) => {
                    if (isFinishedChoice(value) && !settings.pending)
                      settings.change({ finished: value }, 'finished');
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t('notifications.finished.label')}
                    aria-busy={settings.pending || undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_FINISHED_NOTIFY.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`notifications.finished.modes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ItemActions>
              {finishedError && (
                <ItemFooter
                  role="alert"
                  className="settings-inline-error items-start justify-start"
                >
                  <CircleAlert aria-hidden="true" />
                  <span>{finishedError}</span>
                </ItemFooter>
              )}
            </li>
          </Item>
          <SettingsSwitchRow
            id="settings-notifications-attention"
            anchor="settings-notifications-attention"
            title={t('notifications.attention.title')}
            description={t('notifications.attention.description')}
            checked={preferences.attention}
            disabled={settings.unavailable}
            pending={settings.pending}
            note={settings.errorFor('attention')}
            onCheckedChange={(value) => settings.change({ attention: value }, 'attention')}
          />
          <SettingsSwitchRow
            id="settings-notifications-sound"
            anchor="settings-notifications-sound"
            title={t('notifications.sound.title')}
            description={t('notifications.sound.description')}
            checked={preferences.sound}
            disabled={settings.unavailable}
            pending={settings.pending}
            note={settings.errorFor('sound')}
            onCheckedChange={(value) => settings.change({ sound: value }, 'sound')}
          />
          <SettingsSwitchRow
            id="settings-notifications-previews"
            anchor="settings-notifications-previews"
            title={t('notifications.previews.title')}
            description={t('notifications.previews.description')}
            checked={preferences.previews}
            disabled={settings.unavailable}
            pending={settings.pending}
            note={settings.errorFor('previews')}
            onCheckedChange={(value) => settings.change({ previews: value }, 'previews')}
          />
          {settings.permission === 'denied' && (
            <Item asChild size="sm" className="settings-card-row">
              <li>
                <ItemMedia variant="icon">
                  <BellOff aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-[min(120px,100%)]">
                  <ItemTitle className="whitespace-normal">
                    {t('notifications.denied.title')}
                  </ItemTitle>
                  <ItemDescription className="whitespace-normal">
                    {t('notifications.denied.description')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={settings.openSystemSettings}
                  >
                    {t('notifications.denied.open')}
                  </Button>
                </ItemActions>
                {permissionError && (
                  <ItemFooter
                    role="alert"
                    className="settings-inline-error items-start justify-start"
                  >
                    <CircleAlert aria-hidden="true" />
                    <span>{permissionError}</span>
                  </ItemFooter>
                )}
              </li>
            </Item>
          )}
        </ItemGroup>
      </Card>
    </section>
  );
}
