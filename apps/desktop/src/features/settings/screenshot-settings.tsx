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
  DEFAULT_SCREENSHOT_COPY_ON_CONFIRM,
  LONG_SCREENSHOT_CONFIRM_ACTIONS,
  isLongScreenshotConfirmAction,
  type SettingsSnapshot,
} from '../../client/settings-contract';
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

/**
 * General › Screenshot: whether confirming a screenshot copies it to the clipboard too, and what
 * clicking Done in long screenshot does.
 */
export function ScreenshotSettings({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const descriptionId = useId();
  const saveCopy = window.desktop?.settings.setScreenshotCopyOnConfirm;
  const saveConfirmAction = window.desktop?.settings.setLongScreenshotConfirmAction;
  const copySaving = useSaving(t('screenshot.copyOnConfirm.saveFailed'));
  const confirmSaving = useSaving(t('screenshot.longScreenshotConfirmAction.saveFailed'));
  const confirmAction =
    snapshot?.longScreenshotConfirmAction ?? DEFAULT_LONG_SCREENSHOT_CONFIRM_ACTION;

  return (
    <section className="settings-shortcut-group" aria-labelledby="settings-screenshot-group">
      <h3 id="settings-screenshot-group" className="settings-section-title">
        {t('screenshot.title')}
      </h3>
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <SettingsSwitchRow
            id="settings-screenshot-copy-on-confirm"
            anchor="settings-screenshot-copy-on-confirm"
            title={t('screenshot.copyOnConfirm.title')}
            description={t('screenshot.copyOnConfirm.description')}
            checked={snapshot?.screenshotCopyOnConfirm ?? DEFAULT_SCREENSHOT_COPY_ON_CONFIRM}
            disabled={!snapshot || !saveCopy}
            pending={copySaving.pending}
            note={copySaving.error}
            onCheckedChange={(enabled) => saveCopy && void copySaving.run(() => saveCopy(enabled))}
          />
          <Item asChild size="sm" className="settings-card-row">
            <li data-settings-anchor="settings-long-screenshot-confirm-action">
              {/* Wide enough that the select wraps below a long description in a narrow column. */}
              <ItemContent className="min-w-[min(200px,100%)]">
                <ItemTitle className="whitespace-normal">
                  {t('screenshot.longScreenshotConfirmAction.title')}
                </ItemTitle>
                <ItemDescription id={descriptionId} className="whitespace-normal">
                  {t('screenshot.longScreenshotConfirmAction.description')}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="ml-auto flex-wrap justify-end">
                <Select
                  value={confirmAction}
                  disabled={!snapshot || !saveConfirmAction}
                  onValueChange={(next) => {
                    if (saveConfirmAction && isLongScreenshotConfirmAction(next)) {
                      void confirmSaving.run(() => saveConfirmAction(next));
                    }
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label={t('screenshot.longScreenshotConfirmAction.label')}
                    aria-describedby={descriptionId}
                    aria-busy={confirmSaving.pending || undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LONG_SCREENSHOT_CONFIRM_ACTIONS.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`screenshot.longScreenshotConfirmAction.modes.${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ItemActions>
              {confirmSaving.error && (
                <ItemFooter
                  role="alert"
                  className="settings-inline-error items-start justify-start"
                >
                  <CircleAlert aria-hidden="true" />
                  <span>{confirmSaving.error}</span>
                </ItemFooter>
              )}
            </li>
          </Item>
        </ItemGroup>
      </Card>
    </section>
  );
}
