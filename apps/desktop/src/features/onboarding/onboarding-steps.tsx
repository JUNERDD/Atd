import { useTranslation } from 'react-i18next';
import { DEFAULT_SHORTCUTS } from '@atd/agent-contracts';
import { DEFAULT_SELECTION_TOOLBAR } from '../../client/settings-contract';
import { AppsArt } from './art-apps';
import { FinishArt } from './art-finish';
import { HotkeyArt } from './art-hotkey';
import { ProviderArt } from './art-provider';
import { ScreenshotArt } from './art-screenshot';
import { SelectionPractice } from './art-selection';
import { WelcomeArt } from './art-welcome';
import type { OnboardingStepId, OnboardingStepView, StepRenderProps } from './onboarding-types';
import { AppsStep } from './step-apps';
import { FinishStep } from './step-finish';
import { HotkeyStep } from './step-hotkey';
import { ProviderStep } from './step-provider';
import { ScreenshotStep } from './step-screenshot';
import { SelectionStep } from './step-selection';
import { WelcomeStep } from './step-welcome';
import { readyConnection } from './use-onboarding-goals';

/**
 * One step as the card lays it out: its left-column content, its right-column art and the
 * primary button's label. Goal steps and the apps introduction label the primary Continue; the
 * card disables it (with its reason) while a goal step's goal is unmet.
 */
export function useStepView(step: OnboardingStepId, props: StepRenderProps): OnboardingStepView {
  const { t } = useTranslation('onboarding');
  const { snapshot, goals } = props;
  const proceed = t('chrome.continue');
  switch (step) {
    case 'welcome':
      return {
        content: <WelcomeStep {...props} />,
        art: <WelcomeArt />,
        primaryLabel: t('welcome.primary'),
      };
    case 'hotkey':
      return {
        content: <HotkeyStep {...props} />,
        art: (
          <HotkeyArt
            accelerator={(snapshot?.shortcuts ?? DEFAULT_SHORTCUTS).togglePanel}
            platform={window.desktop?.platform ?? 'web'}
          />
        ),
        primaryLabel: proceed,
      };
    case 'selection':
      return {
        content: <SelectionStep {...props} />,
        art: (
          <SelectionPractice
            enabled={snapshot?.selectionToolbar.enabled === true}
            activation={snapshot?.selectionToolbar ?? DEFAULT_SELECTION_TOOLBAR}
            trusted={goals.selection}
            active={props.atRest}
            platform={window.desktop?.platform ?? 'web'}
          />
        ),
        artIsContent: true,
        primaryLabel: proceed,
      };
    case 'screenshot':
      return {
        content: <ScreenshotStep {...props} />,
        art: <ScreenshotArt granted={goals.screenshot} />,
        primaryLabel: proceed,
      };
    case 'provider':
      return {
        content: <ProviderStep {...props} />,
        art: <ProviderArt connected={readyConnection(snapshot)?.connection.provider ?? null} />,
        primaryLabel: proceed,
      };
    case 'apps':
      return {
        content: <AppsStep {...props} />,
        art: <AppsArt />,
        primaryLabel: proceed,
      };
    case 'finish':
      return {
        content: <FinishStep {...props} />,
        art: <FinishArt goals={goals} />,
        primaryLabel: t('finish.primary'),
      };
  }
}
