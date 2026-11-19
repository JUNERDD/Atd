import { useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import {
  Item,
  ItemActions,
  ItemContent,
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
  DEFAULT_SCREENSHOT_CONFIRM_ACTION,
  SCREENSHOT_CONFIRM_ACTIONS,
  isScreenshotConfirmAction,
  type ScreenshotConfirmAction,
} from '../../client/settings-contract';
import { shortcutKeys } from '../../lib/shortcuts';
import { ShortcutConflictHint } from '../settings/shortcut-conflict-hint';
import { ShortcutRow } from '../settings/shortcut-row';
import { useShortcutSettings } from '../settings/use-shortcut-settings';
import { GoalStatus, KeysSentence, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';
import { PermissionRow } from './permission-row';

const CONFIRM_MODE_KEYS = {
  attachAndCopy: 'screenshot.confirmAction.modes.attachAndCopy',
  attach: 'screenshot.confirmAction.modes.attach',
  copy: 'screenshot.confirmAction.modes.copy',
} as const satisfies Record<ScreenshotConfirmAction, string>;

/**
 * Step 4: screen capture. The goal is the Screen Recording grant this running app holds, which the
 * shell reports; the permission row opens System Settings, where macOS asks, and notes that macOS
 * may want Atd reopened before the grant applies. Below, the capture and recording shortcuts and
 * the compact screenshot confirmation preference can be adjusted inline.
 */
export function ScreenshotStep({ snapshot, goals, focusHeading, saveProgress }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const { t: tSettings } = useTranslation('settings');
  const shortcutSettings = useShortcutSettings(snapshot);
  const saveConfirmAction = window.desktop?.settings.setScreenshotConfirmAction;
  const [confirmPending, setConfirmPending] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();
  const confirmAction = snapshot?.screenshotConfirmAction ?? DEFAULT_SCREENSHOT_CONFIRM_ACTION;
  const desktopApp = window.desktop !== undefined;
  const screenshotFailed = desktopApp && snapshot?.screenshotShortcutAvailable === false;
  const recordUnbound = shortcutSettings.unboundText('recordScreen');
  const recordFailed = desktopApp && !recordUnbound && snapshot?.recordShortcutAvailable === false;
  const keys = shortcutKeys(shortcutSettings.bindings.captureScreenshot, shortcutSettings.platform);

  async function changeConfirmAction(next: ScreenshotConfirmAction) {
    if (!saveConfirmAction || confirmPending) return;
    setConfirmError(undefined);
    setConfirmPending(true);
    try {
      await saveConfirmAction(next);
    } catch (reason) {
      setConfirmError(
        reason instanceof Error && reason.message
          ? reason.message
          : tSettings('screenshot.confirmAction.saveFailed'),
      );
    }
    setConfirmPending(false);
  }

  return (
    <OnboardingStep
      title={t('screenshot.title')}
      description={
        <KeysSentence
          sentence={(shortcut) => t('screenshot.description', { shortcut })}
          keys={keys}
        />
      }
      status={
        <GoalStatus
          met={goals.screenshot}
          waiting={t('screenshot.waiting')}
          success={t('screenshot.success')}
        />
      }
      focusHeading={focusHeading}
    >
      <Card size="sm" className="settings-card">
        <ItemGroup>
          <PermissionRow
            trusted={goals.screenshot}
            request={async () => {
              await saveProgress();
              await window.desktop?.settings.requestScreenRecording();
            }}
            copy={{
              title: t('screenshot.screenRecording.title'),
              description: t('screenshot.screenRecording.description'),
              granted: t('screenshot.screenRecording.granted'),
              open: t('screenshot.screenRecording.open'),
              error: t('screenshot.screenRecording.error'),
            }}
          />
        </ItemGroup>
      </Card>
      <div className="guide-group">
        <Card size="sm" className="settings-card">
          <ItemGroup>
            <ShortcutRow
              action="captureScreenshot"
              label={t('screenshot.captureRow')}
              settings={shortcutSettings}
              compact
              error={screenshotFailed ? tSettings('shortcuts.errors.register') : undefined}
            />
            <ShortcutRow
              action="recordScreen"
              label={t('screenshot.recordRow')}
              settings={shortcutSettings}
              compact
              error={
                recordUnbound || (recordFailed ? tSettings('shortcuts.errors.register') : undefined)
              }
            />
            <Item asChild size="sm" className="settings-card-row">
              <li>
                <ItemContent className="min-w-0">
                  <ItemTitle className="whitespace-normal">
                    {t('screenshot.confirmTitle')}
                  </ItemTitle>
                </ItemContent>
                <ItemActions className="ml-auto max-w-full flex-wrap justify-end">
                  <Select
                    value={confirmAction}
                    disabled={!snapshot || !saveConfirmAction}
                    onValueChange={(next) => {
                      if (saveConfirmAction && isScreenshotConfirmAction(next)) {
                        void changeConfirmAction(next);
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="max-w-full"
                      aria-label={t('screenshot.confirmLabel')}
                      aria-busy={confirmPending || undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCREENSHOT_CONFIRM_ACTIONS.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {tSettings(CONFIRM_MODE_KEYS[mode])}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ItemActions>
                {confirmError && (
                  <ItemFooter
                    role="alert"
                    className="settings-inline-error items-start justify-start"
                  >
                    <CircleAlert aria-hidden="true" />
                    <span>{confirmError}</span>
                  </ItemFooter>
                )}
              </li>
            </Item>
          </ItemGroup>
        </Card>
        {!screenshotFailed && !recordFailed && <ShortcutConflictHint />}
      </div>
    </OnboardingStep>
  );
}
