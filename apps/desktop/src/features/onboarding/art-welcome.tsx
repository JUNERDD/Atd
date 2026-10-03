import { useContext, useState } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { AppIcon, ArtStage } from './art-panel';
import { HANDOFF_SPRING } from './onboarding-motion';
import { MARK_LAYOUT_ID, MarkHandoffContext } from './onboarding-mark';

/**
 * Page one's material: the app icon centered on its glow, as one box whose proportions depend
 * only on its width (`--guide-mark-width`, see `art-illustration.css`). The intro's copy and the
 * Welcome art's copy differ only in that width, so the hand-off between them scales uniformly and
 * the two look the same at every point of the travel. `glow` takes the glow's own motion props
 * (the intro fades its glow while handing off).
 */
export function AppMark({
  glow,
  ...props
}: Omit<HTMLMotionProps<'div'>, 'className' | 'children'> & { glow?: HTMLMotionProps<'span'> }) {
  return (
    <motion.div {...props} className="guide-mark">
      <motion.span {...glow} className="guide-glow" />
      <AppIcon />
    </motion.div>
  );
}

/**
 * The app icon over its soft, slowly drifting glow (a CSS loop, still under Reduce Motion). When
 * the card appears from the timed intro, the mark arrives from the intro (the shared layout id
 * moves the intro's mark here); otherwise (a skipped intro, Reduce Motion, coming back to the
 * step) it is simply in place, appearing with the card or the step.
 */
export function WelcomeArt() {
  const handoff = useContext(MarkHandoffContext);
  // Read once: the hand-off ends while this art stays mounted, and its layout id must not change.
  const [takeOver] = useState(handoff);
  return (
    <ArtStage name="welcome">
      <AppMark
        {...(takeOver ? { layoutId: MARK_LAYOUT_ID } : {})}
        transition={{ layout: HANDOFF_SPRING }}
      />
    </ArtStage>
  );
}
