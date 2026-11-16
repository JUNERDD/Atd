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
  DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_SCREENSHOT_CONFIRM_ACTION,
  DEFAULT_SCREENSHOT_CONFIRM_IN_COMPOSER,
  LONG_SCREENSHOT_CONFIRM_ACTIONS,
  SCREENSHOT_CONFIRM_ACTIONS,
  isLongScreenshotConfirmAction,
  isScreenshotConfirmAction,
  type SettingsSnapshot,
} from '../../client/settings-contract';
import { SaveLocationRow } from './save-location-row';
import { useSettingsSectionExit } from './settings-navigation';
import { SettingsSwitchRow } from './settings-switch-row';

/** Runs one preference save with its own pending flag and section-scoped error. */
function useSaving(failedMessage: string) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  useSettingsSectionExit(() => setError(undefined));

  async function run(save: () => Promise<unknown>) {
    if (pending) return;
    setError(undefined);
    setPending(true);
    try {
      await save();
    } catch (reason) {
      setError(reason instanceof Error && reason.message ? reason.message : failedMessage);
    }
    setPending(false);
  }

  return { pending, error, run };
}

/** Shared select row for screenshot confirmation preferences with wrapping actions and error state. */
function ScreenshotSelectRow<Mode extends string>({
  anchor,
  title,
  description,
  label,
  value,
  modes,
  modeLabel,
  disabled,
  pending,
  error,
  onValueChange,
}: {
  anchor: string;
  title: string;
  description: string;
  label: string;
  value: Mode;
  modes: readonly Mode[];
  modeLabel: (mode: Mode) => string;
  disabled: boolean;
  pending: boolean;
  error?: string | undefined;
  onValueChange: (next: string) => void;
}) {
  const descriptionId = useId();
  return (
    <Item asChild size="sm" className="settings-card-row">
      <li data-settings-anchor={anchor}>
        {/* Wide enough that the select wraps below a long description in a narrow column. */}
        <ItemContent className="min-w-[min(200px,100%)]">
          <ItemTitle className="whitespace-normal">{title}</ItemTitle>
          <ItemDescription id={descriptionId} className="whitespace-normal">
            {description}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="ml-auto max-w-full flex-wrap justify-end">
          <Select value={value} disabled={disabled} onValueChange={onValueChange}>
            <SelectTrigger
              size="sm"
              className="max-w-full"
              aria-label={label}
              aria-describedby={descriptionId}
              aria-busy={pending || undefined}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {modeLabel(mode)}
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

/**
 * General › Screenshot: the local save folder, what confirming a screenshot does, whether that
 * also applies when capturing from the composer's "+ › Screenshot", and what clicking Done in long
 * screenshot does.
 */
export function ScreenshotSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const saveConfirmAction = window.desktop?.settings.setScreenshotConfirmAction;
  const saveConfirmInComposer = window.desktop?.settings.setScreenshotConfirmInComposer;
  const saveLongConfirmAction = window.desktop?.settings.setLongScreenshotConfirmAction;
  const confirmSaving = useSaving(t('screenshot.confirmAction.saveFailed'));
  const composerSaving = useSaving(t('screenshot.confirmInComposer.saveFailed'));
  const longConfirmSaving = useSaving(t('screenshot.longScreenshotConfirmAction.saveFailed'));
  const confirmAction = snapshot?.screenshotConfirmAction ?? DEFAULT_SCREENSHOT_CONFIRM_ACTION;
  const longConfirmAction =
    snapshot?.longScreenshotConfirmAction ?? DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION;

  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-screenshot-group">
      <h3 id="settings-screenshot-group" className="settings-section-title">
        {t('screenshot.title')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SaveLocationRow
            kind="screenshot"
            anchor="settings-screenshot-save-location"
            label={t('saveLocation.label')}
            description={t('screenshot.saveLocation.description')}
            saveFailedMessage={t('screenshot.saveLocation.saveFailed')}
          />
          <ScreenshotSelectRow
            anchor="settings-screenshot-confirm-action"
            title={t('screenshot.confirmAction.title')}
            description={t('screenshot.confirmAction.description')}
            label={t('screenshot.confirmAction.label')}
            value={confirmAction}
            modes={SCREENSHOT_CONFIRM_ACTIONS}
            modeLabel={(mode) => t(`screenshot.confirmAction.modes.${mode}`)}
            disabled={!snapshot || !saveConfirmAction}
            pending={confirmSaving.pending}
            error={confirmSaving.error}
            onValueChange={(next) => {
              if (saveConfirmAction && isScreenshotConfirmAction(next)) {
                void confirmSaving.run(() => saveConfirmAction(next));
              }
            }}
          />
          <SettingsSwitchRow
            id="settings-screenshot-confirm-in-composer"
            anchor="settings-screenshot-confirm-in-composer"
            title={t('screenshot.confirmInComposer.title')}
            description={t('screenshot.confirmInComposer.description')}
            checked={
              snapshot?.screenshotConfirmInComposer ?? DEFAULT_SCREENSHOT_CONFIRM_IN_COMPOSER
            }
            disabled={!snapshot || !saveConfirmInComposer}
            pending={composerSaving.pending}
            note={composerSaving.error}
            onCheckedChange={(enabled) =>
              saveConfirmInComposer && void composerSaving.run(() => saveConfirmInComposer(enabled))
            }
          />
          <ScreenshotSelectRow
            anchor="settings-long-screenshot-confirm-action"
            title={t('screenshot.longScreenshotConfirmAction.title')}
            description={t('screenshot.longScreenshotConfirmAction.description')}
            label={t('screenshot.longScreenshotConfirmAction.label')}
            value={longConfirmAction}
            modes={LONG_SCREENSHOT_CONFIRM_ACTIONS}
            modeLabel={(mode) => t(`screenshot.longScreenshotConfirmAction.modes.${mode}`)}
            disabled={!snapshot || !saveLongConfirmAction}
            pending={longConfirmSaving.pending}
            error={longConfirmSaving.error}
            onValueChange={(next) => {
              if (saveLongConfirmAction && isLongScreenshotConfirmAction(next)) {
                void longConfirmSaving.run(() => saveLongConfirmAction(next));
              }
            }}
          />
        </ItemGroup>
      </Card>
    </section>
  );
}
