import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { SNAPPY_SPRING } from './onboarding-motion';
import { isGoalStep, type OnboardingGoals } from './onboarding-types';
import { ONBOARDING_STEPS, STEP_NAME_KEYS } from './use-onboarding-flow';

/**
 * The card's progress, leading the top bar beside the music and close controls: one dot per step.
 * Each dot sits in a ghost icon button (24px, the button's own hover and focus states); the
 * current step is a short pill,
 * one shared element (`layoutId`) that slides to the next dot. Visited steps can be revisited;
 * steps not reached yet are disabled, so the button dims their dot. Each dot's step name is its
 * tooltip and accessible label (a step whose goal is met reads "<step> done"), and the list is
 * named "Step N of M" for screen readers.
 */
export function OnboardingProgress({
  index,
  furthest,
  goals,
  onSelect,
}: {
  index: number;
  furthest: number;
  goals: OnboardingGoals;
  onSelect: (index: number) => void;
}) {
  const { t } = useTranslation('onboarding');
  const label = t('chrome.progressLabel', { current: index + 1, total: ONBOARDING_STEPS.length });
  return (
    <nav className="onboarding-progress" aria-label={label}>
      <ol className="onboarding-progress-list">
        {ONBOARDING_STEPS.map((id, position) => {
          const name = t(STEP_NAME_KEYS[id]);
          const done = isGoalStep(id) && goals[id];
          const current = position === index;
          return (
            <li key={id} className="onboarding-progress-item">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={done ? t('chrome.stepDone', { step: name }) : name}
                    aria-current={current ? 'step' : undefined}
                    disabled={position > furthest}
                    onClick={() => onSelect(position)}
                  >
                    {current ? (
                      <motion.span
                        layoutId="onboarding-progress-current"
                        className="onboarding-progress-dot"
                        data-current
                        transition={SNAPPY_SPRING}
                      />
                    ) : (
                      <span className="onboarding-progress-dot" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}>
                  {name}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
