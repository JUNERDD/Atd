import { MotionConfig } from 'motion/react';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { ToastHost } from '../../components/toast';
import { useAppLanguage } from '../../i18n/use-app-language';
import { useSettingsSnapshot } from '../settings/use-settings';
import '../settings/settings.css';
import { OnboardingStage } from './onboarding-stage';
import { useOnboardingGoals } from './use-onboarding-goals';
import './onboarding.css';

/** Below the menu bar, which overlays the window's top edge once the guide has settled. */
const TOAST_TOP = 56;

/**
 * The welcome guide window (`#onboarding`): a borderless, transparent window over the whole
 * display, in which the page draws everything (`html`, `body` and `#root` stay transparent). The
 * stage plays the intro and then shows the guide's card. The goals are watched from the moment the
 * guide opens, so a shortcut pressed during the intro already counts.
 */
export function OnboardingWindow() {
  const { snapshot } = useSettingsSnapshot();
  useAppLanguage(snapshot?.language);
  const goals = useOnboardingGoals(snapshot, window.desktop?.onboarding);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={300}>
        <OnboardingStage snapshot={snapshot} goals={goals} />
        <ToastHost top={TOAST_TOP} />
      </TooltipProvider>
    </MotionConfig>
  );
}
