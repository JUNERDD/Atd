import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { GuideLight } from './guide-light';
import { STEP_LIGHTS } from './lights';
import { ART_FADE } from './onboarding-motion';
import './onboarding-card-art.css';
import type { OnboardingStepId } from './onboarding-types';

/**
 * The card's art panel, the display area beside the step: the step's own light (`lights/`) on a
 * black field under the step's illustration, which scales with the panel. The panel is always
 * dark (`.dark` scopes the theme tokens for the illustrations), whatever the system appearance.
 * On a step change the light and the illustration cross-fade in place together. Decorative, as
 * the step's content says the same, unless the step's art is content of its own (`isContent`, the
 * selection practice).
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
    <div
      className="onboarding-art dark"
      data-step={step}
      aria-hidden={isContent ? undefined : true}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={step}
          className="onboarding-art-slot"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={ART_FADE}
        >
          <GuideLight design={STEP_LIGHTS[step]} className="onboarding-art-light" />
          {art}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
