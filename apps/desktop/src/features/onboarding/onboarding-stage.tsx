import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isComposingKey } from '@atd/ui/lib/ime';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast } from '../../components/toast-store';
import { OnboardingCard } from './onboarding-card';
import { OnboardingIntro } from './onboarding-intro';
import {
  DIM_EASE,
  INTRO,
  INTRO_REDUCED,
  STAGE_FADE,
  STAGE_FADE_DURATION,
} from './onboarding-motion';
import type { OnboardingGoals } from './onboarding-types';
import { OWNS_RETURN, closeOnboarding, settleOnboarding } from './use-onboarding-flow';
import { useOnboardingMusic } from './use-onboarding-music';

/**
 * Where the stage is: the opening page (waiting for the person to begin), the reveal (the page
 * leaving while the card fades in, which looks interactive but is not yet settled), and settled
 * (the shell has been told).
 */
type Phase = 'intro' | 'reveal' | 'settled';

/** Seconds of the scrim's ramp to the card's level after the reveal. */
const SCRIM_EASE = 0.8;

/** Return and Space (outside controls that use them) and Esc begin the guide from the hero. */
function useBeginKeys(active: boolean, begin: () => void) {
  const run = useEffectEvent(begin);
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || isComposingKey(event)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inControl = event.target instanceof Element && event.target.closest(OWNS_RETURN);
      const beginKey =
        event.key === 'Escape' || ((event.key === 'Enter' || event.key === ' ') && !inControl);
      if (!beginKey) return;
      event.preventDefault();
      run();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

/**
 * The whole guide over the desktop: a full-viewport scrim (the window itself is transparent), the
 * opening page, then the card. The page's timeline starts when the stage mounts (the music's t=0
 * is `INTRO.musicAt` later), and the page stays until the person begins: then it leaves as the
 * card fades in, and once the card is at rest the shell is told to drop the window below the menu
 * bar (`settle`, exactly once). Closing fades the stage and the music, then asks the shell to
 * close.
 */
export function OnboardingStage({
  snapshot,
  goals,
}: {
  snapshot: SettingsSnapshot | null;
  goals: OnboardingGoals;
}) {
  const reduced = useReducedMotion() ?? false;
  // The music begins as the room dims (at once under Reduce Motion), so its bloom lands with the
  // opening page's light.
  const [musicAt] = useState(() => performance.now() + (reduced ? 0 : INTRO.musicAt * 1000));
  const music = useOnboardingMusic(musicAt);
  const [phase, setPhase] = useState<Phase>('intro');
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const settledRef = useRef(false);
  const settleAfter = (reduced ? INTRO_REDUCED : INTRO).settleAfter;

  useEffect(() => {
    if (phase !== 'reveal') return;
    const timer = window.setTimeout(() => setPhase('settled'), settleAfter * 1000);
    return () => window.clearTimeout(timer);
  }, [phase, settleAfter]);

  useEffect(() => {
    if (phase !== 'settled' || settledRef.current) return;
    settledRef.current = true;
    settleOnboarding().catch((error: unknown) => {
      console.error('The welcome guide could not settle its window:', error);
    });
  }, [phase]);

  function begin() {
    setPhase((current) => (current === 'intro' ? 'reveal' : current));
  }
  useBeginKeys(phase === 'intro', begin);

  function close(summon: boolean) {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    const wait = Math.max(STAGE_FADE_DURATION, music.fadeOut()) * 1000;
    window.setTimeout(() => {
      closeOnboarding(summon).catch((error: unknown) => {
        closingRef.current = false;
        setClosing(false);
        showErrorToast(error);
      });
    }, wait);
  }

  return (
    <motion.div
      className="onboarding-stage"
      data-closing={closing || undefined}
      initial={false}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={STAGE_FADE}
    >
      <motion.div
        aria-hidden
        className="onboarding-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === 'intro' ? INTRO.scrimIntro : INTRO.scrimCard }}
        transition={
          phase === 'intro'
            ? { duration: reduced ? INTRO_REDUCED.scrimIn : INTRO.scrimIn, ease: DIM_EASE }
            : { duration: SCRIM_EASE, ease: 'easeInOut' }
        }
      />
      <AnimatePresence>
        {phase === 'intro' && (
          <OnboardingIntro key="intro" reduced={reduced} music={music} onBegin={begin} />
        )}
      </AnimatePresence>
      {phase !== 'intro' && (
        <OnboardingCard
          snapshot={snapshot}
          goals={goals}
          music={music}
          entrance={reduced ? 'fade' : 'skip'}
          settled={phase === 'settled'}
          closing={closing}
          onClose={close}
        />
      )}
    </motion.div>
  );
}
