import type { Transition } from 'motion/react';
import { ONBOARDING_THEME } from './assets/onboarding-theme';

/*
 * The welcome guide stage's motion vocabulary (the steps' own is `step-motion.ts`, whose `FADE`
 * and `morphIn` the stage reuses). Springs are set by perceptual duration (`visualDuration`) and
 * bounce. Taps and state changes never bounce; only the finish check may, and at most 0.3. The
 * window's `MotionConfig` (`reducedMotion="user"`) drops transform and layout
 * animation under Reduce Motion; the intro then runs its own fade-only timeline, and step changes
 * cross-fade. Only transform and opacity are ever animated.
 */

/** A step sliding in or out. */
export const STEP_SPRING: Transition = { type: 'spring', visualDuration: 0.35, bounce: 0 };

/** Selection moving: the progress indicator's ring sliding to the current step. */
export const SNAPPY_SPRING: Transition = { type: 'spring', visualDuration: 0.25, bounce: 0.15 };

/** How far a step travels as it slides, in px. */
export const STEP_OFFSET = 28;

/**
 * The opening page's timeline, in seconds from the moment the stage mounts (the music's t=0, see
 * `use-onboarding-music.ts`). The horizon light plays its entrance from `lightAt` and lands on the
 * music's bloom (`ONBOARDING_THEME.revealAt`). The hero's copy starts arriving while the light is
 * still settling, line by line and slowly, so its last line comes to rest just after the bloom.
 * The page then waits for the person to begin; the card fades in as the page leaves, and the
 * shell is told the guide settled once the card is at rest.
 */
export const INTRO = {
  /**
   * The scrim darkens the desktop for the opening page, light enough to show its glass's blur, then
   * eases back for the card.
   */
  scrimIntro: 0.7,
  scrimCard: 0.6,
  scrimIn: 0.8,
  /** The light starts its entrance... */
  lightAt: 0.2,
  /** ...and lands here, on the bloom. */
  landAt: ONBOARDING_THEME.revealAt,
  /** The hero's first line starts arriving, while the light settles... */
  heroAt: 1.9,
  /** ...each next line this much later... */
  heroStagger: 0.22,
  /** ...each taking this long to rise this far (px) and fade in. */
  heroIn: 1.6,
  heroRise: 18,
  /** The music toggle in the corner. */
  cornerAt: 0.6,
  /** From the start to the card at rest. */
  settleAfter: 0.8,
  /** Between the card's content groups; four groups stay within 150ms. */
  contentStagger: 0.04,
} as const;

/**
 * The Reduce Motion opening page: the light, a still frame, fades in and the hero follows; nothing
 * moves or scales. The card then cross-fades in and settles.
 */
export const INTRO_REDUCED = {
  lightAt: 0.2,
  heroAt: 0.5,
  settleAfter: 0.4,
} as const;

/** Text that belongs to the opening page lifting away as the guide begins. */
export const LIFT_AWAY: Transition = { duration: 0.35, ease: [0.4, 0, 1, 1] };

/** Seconds the whole stage takes to fade out when the guide closes. */
export const STAGE_FADE_DURATION = 0.3;

/** The whole stage fading out as the guide closes. */
export const STAGE_FADE: Transition = { duration: STAGE_FADE_DURATION, ease: 'easeInOut' };

/** Seconds the art panel takes to cross-fade to the next step's illustration. */
export const ART_FADE_DURATION = 0.5;

/** The art panel's illustration cross-fading to the next step's. */
export const ART_FADE: Transition = { duration: ART_FADE_DURATION, ease: 'easeInOut' };
