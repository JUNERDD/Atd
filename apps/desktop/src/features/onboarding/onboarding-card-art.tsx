import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ART_FADE } from './onboarding-motion';
import './onboarding-card-art.css';
import type { OnboardingStepId } from './onboarding-types';

/**
 * The card's art panel, the display area beside the step: a quiet neutral field (the settings
 * sidebar card's tint and hairline) under the step's illustration, which scales with the panel.
 * On a step change the illustrations cross-fade in place. Decorative, as the step's content says
 * the same, unless the step's art is content of its own (`isContent`, the selection practice).
 */
export function OnboardingCardArt({
  step,
  art,
  isContent = false,
}: {
  step: OnboardingStepId;
  art: ReactNode;
  isContent?: boolean;
}) {
  return (
    <div className="onboarding-art" data-step={step} aria-hidden={isContent ? undefined : true}>
      <AnimatePresence initial={false}>
        <motion.div
          key={step}
          className="onboarding-art-slot"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={ART_FADE}
        >
          {art}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
