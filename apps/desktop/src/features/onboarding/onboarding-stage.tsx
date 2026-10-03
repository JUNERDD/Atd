import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { isComposingKey } from '@atd/ui/lib/ime';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { showErrorToast } from '../../components/toast-store';
import { OnboardingCard } from './onboarding-card';
import { OnboardingIntro } from './onboarding-intro';
import { MarkHandoffContext } from './onboarding-mark';
import { INTRO, INTRO_REDUCED, STAGE_FADE, STAGE_FADE_DURATION } from './onboarding-motion';
import type { OnboardingGoals } from './onboarding-types';
import { OWNS_RETURN, closeOnboarding, settleOnboarding } from './use-onboarding-flow';
import { useOnboardingMusic } from './use-onboarding-music';

/**
 * Where the stage is: the intro playing, the reveal (the intro's mark travelling into the card,
 * which fades in around it and looks interactive but is not yet settled), and settled (the shell
 * has been told).
 */
type Phase = 'intro' | 'reveal' | 'settled';

/** Seconds of the scrim's ramp to the card's level after the reveal. */
const SCRIM_EASE = 0.8;

/**
 * Esc, Return and Space (outside controls that use them) and clicks outside buttons skip the
 * intro while it plays.
 */
function useSkipInput(active: boolean, skip: () => void) {
  const run = useEffectEvent(skip);
  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat || isComposingKey(event)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inControl = event.target instanceof Element && event.target.closest(OWNS_RETURN);
      const skipKey =
        event.key === 'Escape' || ((event.key === 'Enter' || event.key === ' ') && !inControl);
      if (!skipKey) return;
      event.preventDefault();
      run();
    }
    function onClick(event: MouseEvent) {
      if (event.target instanceof Element && event.target.closest('button')) return;
      run();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onClick);
    };
  }, [active]);
}

/**
 * The whole guide over the desktop: a full-viewport scrim (the window itself is transparent), the
 * intro, then the card. The timeline starts when the stage mounts, which is also the music's t=0:
 * at `revealAt` the intro leaves and the card fades in, while the intro's mark travels into the
 * Welcome step's display area (`MarkHandoffContext`; a cross-fade without travel under Reduce
 * Motion, and the card at rest with the mark in place after a skip). Once the card is at rest the
 * shell is told to drop the window below the menu bar (`settle`, exactly once, skipped or not). Closing fades the stage and the music,
 * then asks the shell to close.
 */
export function OnboardingStage({
  snapshot,
  goals,
}: {
  snapshot: SettingsSnapshot | null;
  goals: OnboardingGoals;
}) {
  const reduced = useReducedMotion() ?? false;
  const [startedAt] = useState(() => performance.now());
  const music = useOnboardingMusic(startedAt);
  const [phase, setPhase] = useState<Phase>('intro');
  const [skipped, setSkipped] = useState(false);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const settledRef = useRef(false);
  const timeline = reduced ? INTRO_REDUCED : INTRO;

  useEffect(() => {
    if (phase !== 'intro') return;
    const remaining = timeline.revealAt * 1000 - (performance.now() - startedAt);
    const timer = window.setTimeout(() => setPhase('reveal'), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [phase, startedAt, timeline.revealAt]);

  useEffect(() => {
    if (phase !== 'reveal') return;
    const timer = window.setTimeout(() => setPhase('settled'), timeline.settleAfter * 1000);
    return () => window.clearTimeout(timer);
  }, [phase, timeline.settleAfter]);

  useEffect(() => {
    if (phase !== 'settled' || settledRef.current) return;
    settledRef.current = true;
    settleOnboarding().catch((error: unknown) => {
      console.error('The welcome guide could not settle its window:', error);
    });
  }, [phase]);

  useSkipInput(phase !== 'settled', () => {
    // A skip during the intro shows the card at rest at once; during the reveal the mark's travel
    // finishes on its own and only the settle comes early.
    if (phase === 'intro') setSkipped(true);
    setPhase('settled');
  });

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
        transition={{ duration: phase === 'intro' ? INTRO.scrimIn : SCRIM_EASE, ease: 'easeInOut' }}
      />
      <AnimatePresence custom={skipped}>
        {phase === 'intro' && <OnboardingIntro key="intro" reduced={reduced} music={music} />}
      </AnimatePresence>
      {phase !== 'intro' && (
        <MarkHandoffContext value={phase === 'reveal' && !reduced}>
          <OnboardingCard
            snapshot={snapshot}
            goals={goals}
            music={music}
            entrance={reduced ? 'fade' : 'skip'}
            settled={phase === 'settled'}
            closing={closing}
            onClose={close}
          />
        </MarkHandoffContext>
      )}
    </motion.div>
  );
}
