import { useEffect, useState } from 'react';
import { MotionConfig } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { OnboardingProgress } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Card } from '@atd/ui/components/card';
import { TooltipProvider } from '@atd/ui/components/tooltip';
import { ToastHost } from '../../components/toast';
import { useAppLanguage } from '../../i18n/use-app-language';
import { useSettingsSnapshot } from '../settings/use-settings';
import { queryClient } from '../../lib/query-client';
import '../settings/settings.css';
import { OnboardingStage } from './onboarding-stage';
import { useOnboardingGoals } from './use-onboarding-goals';
import './onboarding.css';

/** Below the menu bar, which overlays the window's top edge once the guide has settled. */
const TOAST_TOP = 56;

/**
 * Milliseconds the saved progress may take before the page says it is loading. Until then it
 * draws nothing, so a resumed guide appears where it was left without a loading frame first.
 */
const LOADING_NOTICE_AFTER = 1000;

/** Whether `pending` has lasted `LOADING_NOTICE_AFTER`. */
function useSlowLoad(pending: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => setSlow(true), LOADING_NOTICE_AFTER);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return pending && slow;
}

/**
 * The welcome guide window (`#onboarding`): a borderless, transparent window over the whole
 * display, in which the page draws everything (`html`, `body` and `#root` stay transparent). The
 * stage plays the intro and then shows the guide's card. The goals are watched from the moment the
 * guide opens, so a shortcut pressed during the intro already counts.
 */
export function OnboardingWindow() {
  const { t } = useTranslation('onboarding');
  const { snapshot } = useSettingsSnapshot();
  useAppLanguage(snapshot?.language);
  const bridge = window.desktop?.onboarding;
  const progress = useQuery(
    {
      queryKey: ['onboarding', 'progress'],
      queryFn: async () => {
        if (!bridge) throw new Error('The welcome guide requires the desktop app.');
        const saved: OnboardingProgress = (await bridge.getProgress()) ?? {
          step: 'intro',
          furthest: 'welcome',
          hotkeyTested: false,
          musicMuted: false,
        };
        // Opening from the menu also starts a resumable guide. Save before revealing any step.
        await bridge.saveProgress(saved);
        return saved;
      },
      staleTime: Infinity,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const goals = useOnboardingGoals(snapshot, bridge, progress.data?.hotkeyTested);
  const slowLoad = useSlowLoad(progress.isPending);
  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={300}>
        {progress.data ? (
          <OnboardingStage snapshot={snapshot} goals={goals} initialProgress={progress.data} />
        ) : progress.isError || slowLoad ? (
          <div className="onboarding-stage">
            <Card className="mx-8 max-w-md p-6">
              <p role={progress.isError ? 'alert' : 'status'}>
                {t(progress.isError ? 'chrome.loadError' : 'chrome.loading')}
              </p>
              {progress.isError && (
                <Button
                  variant="outline"
                  disabled={progress.isFetching}
                  onClick={() => void progress.refetch()}
                >
                  {t('chrome.retry')}
                </Button>
              )}
            </Card>
          </div>
        ) : null}
        <ToastHost top={TOAST_TOP} />
      </TooltipProvider>
    </MotionConfig>
  );
}
