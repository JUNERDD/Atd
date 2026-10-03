import { useTranslation } from 'react-i18next';
import { CircleAlert, Plus, ShieldAlert, Trash2 } from 'lucide-react';
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
import type { SettingsSnapshot } from '../../client/settings-contract';
import { IconButton } from '../../components/icon-button';
import { SelectionToolbarActivationRows } from './selection-toolbar-activation';
import { SettingsSwitchRow } from './settings-switch-row';
import { useSelectionToolbarSettings } from './use-selection-toolbar-settings';

/** An error under the row that caused it, announced when it appears. */
function RowError({ text }: { text: string | undefined }) {
  if (!text) return null;
  return (
    <ItemFooter role="alert" className="settings-inline-error items-start justify-start">
      <CircleAlert aria-hidden="true" />
      <span>{text}</span>
    </ItemFooter>
  );
}

/**
 * General › Selection toolbar: the switch for the toolbar the shell shows over text selected in
 * other apps, which selections bring it up, the Accessibility state while it is on and the app is
 * not trusted (with the way to System Settings), and the apps it never appears over. Rows wrap their actions below the text at
 * narrow widths, like the other settings rows.
 */
export function SelectionToolbarSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const settings = useSelectionToolbarSettings(snapshot);
  const { value } = settings;
  const apps = value.excludedApps;
  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-selection-toolbar-group">
      <h3 id="settings-selection-toolbar-group" className="settings-section-title">
        {t('selectionToolbar.title')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SettingsSwitchRow
            id="settings-selection-toolbar"
            anchor="settings-selection-toolbar"
            title={t('selectionToolbar.enabled')}
            description={t('selectionToolbar.enabledDescription')}
            checked={value.enabled}
            disabled={settings.unavailable}
            pending={settings.pending}
            note={settings.errors.toggle}
            onCheckedChange={settings.setEnabled}
          />
          <SelectionToolbarActivationRows settings={settings} />
          {value.enabled && settings.trusted === false && (
            <Item asChild size="sm" className="settings-card-row">
              <li>
                <ItemMedia variant="icon">
                  <ShieldAlert aria-hidden="true" />
                </ItemMedia>
                <ItemContent className="min-w-[min(120px,100%)]">
                  <ItemTitle className="whitespace-normal">
                    {t('selectionToolbar.accessibility.title')}
                  </ItemTitle>
                  <ItemDescription className="whitespace-normal">
                    {t('selectionToolbar.accessibility.description')}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="ml-auto">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={settings.openAccessibility}
                  >
                    {t('selectionToolbar.accessibility.open')}
                  </Button>
                </ItemActions>
              </li>
            </Item>
          )}
        </ItemGroup>
      </Card>
      <Card
        size="sm"
        className="settings-card"
        data-settings-anchor="settings-selection-toolbar-apps"
      >
        <ItemGroup aria-label={t('selectionToolbar.excluded.title')}>
          <Item asChild size="sm" className="settings-card-row">
            <li>
              <ItemContent className="min-w-[min(120px,100%)]">
                <ItemTitle className="whitespace-normal">
                  {t('selectionToolbar.excluded.title')}
                </ItemTitle>
                <ItemDescription className="whitespace-normal">
                  {apps.length
                    ? t('selectionToolbar.excluded.description')
                    : t('selectionToolbar.excluded.empty')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={settings.unavailable}
                  aria-disabled={settings.pending || undefined}
                  onClick={settings.addApps}
                >
                  <Plus data-icon="inline-start" />
                  {t('selectionToolbar.excluded.add')}
                </Button>
              </ItemActions>
              <RowError text={settings.errors.apps} />
            </li>
          </Item>
          {apps.map((app) => (
            <Item asChild key={app.bundleId} size="sm" className="settings-card-row">
              <li>
                <ItemContent>
                  <ItemTitle className="max-w-full truncate" title={app.name}>
                    {app.name}
                  </ItemTitle>
                  <ItemDescription className="truncate" title={app.bundleId}>
                    {app.bundleId}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <IconButton
                    size="icon-xs"
                    label={t('selectionToolbar.excluded.remove')}
                    aria-label={t('selectionToolbar.excluded.removeLabel', { name: app.name })}
                    disabled={settings.unavailable}
                    aria-disabled={settings.pending || undefined}
                    onClick={() => settings.removeApp(app.bundleId)}
                  >
                    <Trash2 />
                  </IconButton>
                </ItemActions>
              </li>
            </Item>
          ))}
        </ItemGroup>
      </Card>
    </section>
  );
}
