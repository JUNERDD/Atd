import { motion, type Transition, type Variants } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { INTRO, INTRO_REDUCED, LIFT_AWAY } from './onboarding-motion';
import { AppMark } from './art-welcome';
import { MARK_LAYOUT_ID } from './onboarding-mark';
import { MusicToggle } from './onboarding-stage-controls';
import { FADE } from './step-motion';
import type { OnboardingMusic } from './use-onboarding-music';
import './onboarding-intro.css';

/** The product name, never translated: the intro's heading for assistive technology. */
const PRODUCT_NAME = 'Atd';

/** The light's opacity once it has landed on the glow, under the glow's own light. */
const LIGHT_REST = 0.6;

/** The light's convergence: under way from the start, then a long settle onto the glow. */
const CONVERGE_EASE = [0.3, 0, 0.2, 1] as const;

/** The card's own Reduce Motion cross-fade, which the intro's mark fades out with. */
const CROSS_FADE: Transition = { duration: 0.4, ease: 'easeInOut' };

/*
 * Exits are variants resolved with AnimatePresence's `custom` (whether the intro was skipped),
 * since an exiting element keeps the props of its last render: a skip fades everything at once.
 */
const liftAway: Variants = {
  gone: (skipped: boolean) =>
    skipped ? { opacity: 0, transition: FADE } : { opacity: 0, y: -16, transition: LIFT_AWAY },
};
/*
 * On the timed reveal the Welcome art takes over the mark's layout id, and motion drives this
 * copy's position and opacity: it rides along into the display area and fades from over the copy
 * landing there. This fade only shows when nothing takes over (a skip, or Reduce Motion).
 */
const markExit: Variants = {
  gone: (skipped: boolean) => ({ opacity: 0, transition: skipped ? FADE : CROSS_FADE }),
};
/* The glow hands over to the landing copy's glow (which fades in with the card) as the travel
   starts, so the two translucent glows never stack into a brighter one. */
const glowExit: Variants = {
  gone: (skipped: boolean) => ({
    opacity: 0,
    transition: skipped ? FADE : { delay: 0.1, duration: 0.45, ease: 'easeInOut' },
  }),
};

/** Fading in at `delay`. */
function fadeIn(delay: number) {
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    transition: { delay, duration: 0.8, ease: [0.22, 1, 0.36, 1] },
  } as const;
}

/**
 * The flowing light: turning bands of the glow's cool blue-white (`onboarding-intro.css`) that
 * start far past the screen's edges and converge onto the glow, then rest under it. At the reveal
 * they finish merging into the glow and fade. Under Reduce Motion they only fade in and out, at
 * their landed size and still.
 */
function FlowingLight({ reduced }: { reduced: boolean }) {
  const exit: Variants = {
    gone: (skipped: boolean) =>
      skipped || reduced
        ? { opacity: 0, transition: skipped ? FADE : CROSS_FADE }
        : { opacity: 0, scale: 0.6, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } },
  };
  return (
    <motion.div
      aria-hidden
      className="onboarding-flow"
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: INTRO.lightFrom }}
      animate={reduced ? { opacity: LIGHT_REST } : { opacity: [0, 1, LIGHT_REST], scale: 1 }}
      transition={
        reduced
          ? { delay: INTRO_REDUCED.markAt, duration: 0.6 }
          : {
              scale: { delay: INTRO.lightAt, duration: INTRO.lightConverge, ease: CONVERGE_EASE },
              opacity: {
                delay: INTRO.lightAt,
                duration: INTRO.lightConverge,
                times: [0, 0.3, 1],
                ease: 'easeInOut',
              },
            }
      }
      variants={exit}
      exit="gone"
    >
      <span className="onboarding-flow-layer" data-flow="rays" />
      <span className="onboarding-flow-layer" data-flow="drift" />
      <span className="onboarding-flow-ring" />
    </motion.div>
  );
}

/**
 * Page one's mark (the Welcome art's app icon on its glow), centered: the icon emerges in the
 * gathering light and the glow brightens as the light lands. It carries the mark's layout id, so
 * the Welcome art takes it over at the reveal.
 */
function IntroMark({ reduced }: { reduced: boolean }) {
  const markAt = reduced ? INTRO_REDUCED.markAt : INTRO.markAt;
  return (
    <AppMark
      aria-hidden
      layoutId={MARK_LAYOUT_ID}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={
        reduced
          ? { delay: markAt, duration: 0.6 }
          : {
              opacity: { delay: markAt, duration: 1, ease: 'easeOut' },
              scale: { type: 'spring', visualDuration: 1.4, bounce: 0, delay: markAt },
            }
      }
      variants={markExit}
      exit="gone"
      glow={{
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        transition: reduced
          ? { delay: markAt, duration: 0.6 }
          : { delay: INTRO.glowAt, duration: INTRO.glowIn, ease: 'easeInOut' },
        variants: glowExit,
        exit: 'gone',
      }}
    />
  );
}

/**
 * The full-screen intro over the scrim (and over the card while it leaves): the flowing light
 * converging onto page one's mark, a hint that Return begins, and the music toggle in the corner.
 * The stage owns its timing (when it leaves) and the skip keys; this tree only plays its entrance
 * and its exit.
 */
export function OnboardingIntro({ reduced, music }: { reduced: boolean; music: OnboardingMusic }) {
  const { t } = useTranslation('onboarding');
  return (
    <div className="onboarding-intro">
      <h1 className="sr-only">{PRODUCT_NAME}</h1>
      <FlowingLight reduced={reduced} />
      <IntroMark reduced={reduced} />
      <motion.p
        className="onboarding-intro-hint"
        {...fadeIn(reduced ? INTRO_REDUCED.hintAt : INTRO.hintAt)}
        variants={liftAway}
        exit="gone"
      >
        {t('intro.skipHint')}
      </motion.p>
      <motion.div
        className="onboarding-intro-corner"
        {...fadeIn(reduced ? 0 : INTRO.cornerAt)}
        variants={liftAway}
        exit="gone"
      >
        <MusicToggle music={music} />
      </motion.div>
    </div>
  );
}
