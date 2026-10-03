import type { Transition } from 'motion/react';

/*
 * The steps' motion vocabulary (the stage keeps its own for the intro and the card). Springs are
 * set by perceptual duration and bounce: taps and state changes never bounce; only the finish
 * celebration may, at 0.3. Under Reduce Motion everything here becomes a short cross-fade, and
 * CSS loops in the art stop on a still frame.
 */

/** A status changing in place: a check replacing a prompt, a panel arriving. */
export const STATE_SPRING: Transition = { type: 'spring', visualDuration: 0.3, bounce: 0 };

/** A keycap released after a press. */
export const RELEASE_SPRING: Transition = { type: 'spring', visualDuration: 0.25, bounce: 0.15 };

/** The finish step's one celebratory moment. */
export const CELEBRATION_SPRING: Transition = { type: 'spring', visualDuration: 0.5, bounce: 0.3 };

/** A keycap pressed in: the pressed look lands at once (press in fast, release on a spring). */
export const PRESS_IN: Transition = { duration: 0.09, ease: 'easeOut' };

/** The Reduce Motion substitute for every scale and slide. */
export const FADE: Transition = { duration: 0.2, ease: 'easeInOut' };

/** A status icon morphing in: scale and opacity, or opacity alone under Reduce Motion. */
export function morphIn(reduced: boolean) {
  return {
    initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.6 },
    animate: { opacity: 1, scale: 1 },
    transition: reduced ? FADE : STATE_SPRING,
  };
}
