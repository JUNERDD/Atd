import type { Transition } from 'motion/react';
import { ONBOARDING_THEME } from './assets/onboarding-theme';

/*
 * The welcome guide stage's motion vocabulary (the steps' own is `step-motion.ts`, whose `FADE`
 * and `morphIn` the stage reuses). Springs are set by perceptual duration (`visualDuration`) and
 * bounce. Taps and state changes never bounce; only the finish check may, and at most 0.3. The
 * window's `MotionConfig` (`reducedMotion="user"`) drops transform and layout
 * animation under Reduce Motion; the intro then runs its own fade-only timeline, and step changes
 * cross-fade. Only transform and opacity are animated, with one exception: the opening page's
 * light-flow typewriter (`hero-flow-text.tsx`) also fades a glow (`text-shadow`) on each glyph of
 * its two lines, once, as they are written.
 */

/** A step sliding in or out. */
export const STEP_SPRING: Transition = { type: 'spring', visualDuration: 0.35, bounce: 0 };

/** Selection moving: the progress indicator's ring sliding to the current step. */
export const SNAPPY_SPRING: Transition = { type: 'spring', visualDuration: 0.25, bounce: 0.15 };

/** How far a step travels as it slides, in px. */
export const STEP_OFFSET = 28;

/*
 * The opening page's curves, derived from how brightness is perceived rather than picked by eye.
 * Perceived lightness is close to the cube root of luminance (CIE L*), so a change that should
 * feel even has to follow the cube of that feeling: `S` below is a sine ease-in-out, the shape the
 * change should feel like, and each curve is a least-squares fit of a CSS cubic-bezier to what
 * makes that shape appear.
 */

/**
 * The room dimming: a black scrim at opacity a leaves (1 - a) of the desktop's light, so for its
 * lightness to fall along `S` to the scrim's level A, a = (1 - (1 - (1 - (1 - A)^(1/3)) S)^3) / A,
 * normalized. Fitted for A = 0.7 (max error 0.0005): it dims slowly, then steadily, then settles.
 */
export const DIM_EASE = [0.31, 0, 0.53, 1] as const;

/**
 * Something appearing on black: at opacity a it is seen as a^(1/3), so for it to appear along `S`
 * its opacity follows S^3 (fitted within 0.03): almost nothing for the first third, then a long,
 * even arrival instead of the early pop a plain ease gives.
 */
export const EMERGE_EASE = [0.88, 0, 0.51, 0.6] as const;

/**
 * Something fading out on black, the mirror of `EMERGE_EASE`: for it to fade along `S` its opacity
 * follows (1 - S)^3, so the share of the change done is 1 - (1 - S)^3 (fitted within 0.035). It
 * drops quickly: halfway through only an eighth is left, which is seen as half, where a plain
 * ease-out lingers and then vanishes.
 */
export const FADE_EASE = [0.49, 0.44, 0.14, 1] as const;

/**
 * A rise into place: the decelerating cubic (1 - (1 - t)^3). Its early speed is hidden, since it
 * runs under `EMERGE_EASE`'s nearly invisible start, and it lands without a jolt.
 */
export const RISE_EASE = [0.33, 1, 0.68, 1] as const;

/**
 * The opening page's timeline, in seconds from the moment the stage mounts, paced like a cinema:
 * as the room dims, the music begins and the horizon light emerges with it, landing on the
 * music's bloom (`ONBOARDING_THEME.revealAt` into the track) as the room reaches its dark. As the
 * light settles, the hero's copy is written in by a light-flow typewriter, then the start button
 * rises. The page then waits for the person to begin; the card fades in as the page leaves, and
 * the shell is told the guide settled once the card is at rest.
 */
export const INTRO = {
  /**
   * The scrim dims the desktop to this, light enough to show the glass's blur, over `scrimIn`;
   * the glass dissolves in over the same time, so dimming and defocus read as one gesture.
   */
  scrimIntro: 0.7,
  scrimIn: 2.6,
  /** The scrim's level under the card, reached after the page leaves. */
  scrimCard: 0.6,
  /** The music starts while the room dims... */
  musicAt: 0.5,
  /** ...the light emerges just after it, still in the dimming... */
  lightAt: 0.9,
  /** ...and lands on the music's bloom, just after the room has reached its dark. */
  landAt: 0.5 + ONBOARDING_THEME.revealAt,
  /** The badge arrives as the light nears its landing. */
  badgeAt: 3.6,
  /** The title is written from here, over `titleFor` whatever its length... */
  titleAt: 3.9,
  titleFor: 1.6,
  /** ...the description from here, over `descriptionFor`. */
  descriptionAt: 4.8,
  descriptionFor: 1.4,
  /** The start button and its hint rise in last. */
  actionsAt: 5.9,
  /** How long a line or the button takes to emerge, and how far (px) it rises. */
  emergeFor: 1.4,
  rise: 14,
  /** The music toggle, just after the music begins. */
  cornerAt: 0.9,
  /** From the start to the card at rest. */
  settleAfter: 0.8,
  /** Between the card's content groups; four groups stay within 150ms. */
  contentStagger: 0.04,
} as const;

/**
 * The Reduce Motion opening page: the room dims quickly, the light (a still frame past its
 * entrance) and the hero fade in, and the music starts at once; nothing moves, scales or is typed.
 * The card then cross-fades in and settles.
 */
export const INTRO_REDUCED = {
  scrimIn: 0.5,
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
