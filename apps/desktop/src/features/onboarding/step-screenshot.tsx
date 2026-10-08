import { useTranslation } from 'react-i18next';
import { Card } from '@atd/ui/components/card';
import { ItemGroup } from '@atd/ui/components/item';
import { DEFAULT_SHORTCUTS } from '@atd/agent-contracts';
import { shortcutKeys } from '../../lib/shortcuts';
import { GoalStatus, KeysSentence, OnboardingStep } from './onboarding-step';
import type { StepRenderProps } from './onboarding-types';
import { PermissionRow } from './permission-row';

/**
 * Step 4: screenshots. The goal is the Screen Recording grant this running app holds, which the
 * shell reports; the permission row opens System Settings, where macOS asks, and notes that macOS
 * may want Atd reopened before the grant applies. The description sets the user's shortcut inline
 * and it can be tried for real once access is granted: it captures with the guide in place and
 * the image lands in the panel's composer, which the guide never sends anywhere. Changing the
 * shortcut is Settings' job.
 */
export function ScreenshotStep({ snapshot, goals, focusHeading, saveProgress }: StepRenderProps) {
  const { t } = useTranslation('onboarding');
  const keys = shortcutKeys(
    (snapshot?.shortcuts ?? DEFAULT_SHORTCUTS).captureScreenshot,
    window.desktop?.platform ?? 'web',
  );
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
    </OnboardingStep>
  );
}
