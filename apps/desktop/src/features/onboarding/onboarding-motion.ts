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
 * The intro's timeline, in seconds from the moment the stage mounts (the music's t=0, see
 * `use-onboarding-music.ts`). A flowing light enters from beyond the screen's edges and converges
 * onto page one's mark (the app icon on its glow), landing as its glow before the reveal, which
 * falls on the music's bloom (`ONBOARDING_THEME.revealAt`). There the mark travels into the
 * Welcome step's display area (`HANDOFF_SPRING`) while the card fades in around it; the shell is
 * told the guide settled once the card is at rest.
 */
export const INTRO = {
  /** The scrim darkens the desktop for the intro, then eases back for the card. */
  scrimIntro: 0.82,
  scrimCard: 0.6,
  scrimIn: 0.8,
  /** The flowing light starts in from beyond the edges... */
  lightAt: 0.2,
  /** ...and takes this long to converge onto the glow (landing at 3.3s). */
  lightConverge: 3.1,
  /** How many times its landed size the light starts at: past every display's corners. */
  lightFrom: 7,
  /** The icon emerging inside the gathering light. */
  markAt: 1.2,
  /** The glow brightening as the light lands on it, over `glowIn`. */
  glowAt: 1.5,
  glowIn: 1.8,
  /** The music toggle in the corner. */
  cornerAt: 0.6,
  hintAt: 2.7,
  revealAt: ONBOARDING_THEME.revealAt,
  /** From the reveal to the card at rest (≈4.3s on the timeline). */
  settleAfter: 0.8,
  /** Between the card's content groups; four groups stay within 150ms. */
  contentStagger: 0.04,
} as const;

/**
 * The Reduce Motion intro: the mark and a still light fade in, then the card cross-fades in and
 * settles; nothing travels or scales.
 */
export const INTRO_REDUCED = {
  markAt: 0.2,
  hintAt: 0.5,
  revealAt: 1.2,
  settleAfter: 0.4,
} as const;

/**
 * The mark's travel from the intro into the Welcome step's display area (the shared-layout
 * hand-off). The short delay lets the card's fade get ahead, so the copy the mark lands as is
 * already opaque when the intro's copy fades from over it.
 */
export const HANDOFF_SPRING: Transition = {
  type: 'spring',
  visualDuration: 0.8,
  bounce: 0,
  delay: 0.12,
};

/** Text that belongs to the intro lifting away at the reveal. */
export const LIFT_AWAY: Transition = { duration: 0.35, ease: [0.4, 0, 1, 1] };

/** Seconds the whole stage takes to fade out when the guide closes. */
export const STAGE_FADE_DURATION = 0.3;

/** The whole stage fading out as the guide closes. */
export const STAGE_FADE: Transition = { duration: STAGE_FADE_DURATION, ease: 'easeInOut' };

/** Seconds the art panel takes to cross-fade to the next step's illustration. */
export const ART_FADE_DURATION = 0.5;

/** The art panel's illustration cross-fading to the next step's. */
export const ART_FADE: Transition = { duration: ART_FADE_DURATION, ease: 'easeInOut' };
