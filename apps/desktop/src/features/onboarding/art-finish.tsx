import { Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { GOAL_STEPS, type OnboardingGoals } from './onboarding-types';
import { AppIcon, ArtStage } from './art-panel';
import { CELEBRATION_SPRING, FADE } from './step-motion';

/**
 * The closing art: the app icon, over the finish light the art panel draws, and once every goal is
 * met, the done badge springing onto it (the guide's one bounce). Under Reduce Motion the badge
 * fades in.
 */
export function FinishArt({ goals }: { goals: OnboardingGoals }) {
  const reduced = useReducedMotion() ?? false;
  const complete = GOAL_STEPS.every((step) => goals[step]);
  return (
    <ArtStage name="finish">
      <span className="guide-icon-motion">
        <AppIcon>
          <AnimatePresence>
            {complete && (
              <motion.span
                key="done"
                className="guide-done-badge"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={reduced ? FADE : { ...CELEBRATION_SPRING, delay: 0.15 }}
              >
                <Check />
              </motion.span>
            )}
          </AnimatePresence>
        </AppIcon>
      </span>
    </ArtStage>
  );
}
