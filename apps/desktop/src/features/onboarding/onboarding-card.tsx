import { useLayoutEffect, useRef } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { OnboardingCardArt } from './onboarding-card-art';
import { OnboardingFooter } from './onboarding-footer';
import {
  INTRO,
  STAGE_FADE,
  STAGE_FADE_DURATION,
  STEP_OFFSET,
  STEP_SPRING,
} from './onboarding-motion';
import { OnboardingProgress } from './onboarding-progress';
import { CloseButton, MusicToggle } from './onboarding-stage-controls';
import { useStepView } from './onboarding-steps';
import type { OnboardingGoals } from './onboarding-types';
import { FADE } from './step-motion';
import {
  isGoalPending,
  usePrimaryShortcut,
  useStepAnnouncement,
  type useOnboardingFlow,
} from './use-onboarding-flow';
import type { OnboardingMusic } from './use-onboarding-music';
import { useNativeSurface } from './use-native-surface';

/**
 * The card's corner radius in px (Figma `radius/panel`); the art panel's (14px at an 8px inset)
 * is concentric with it.
 */
const CARD_RADIUS = 22;

/**
 * How the card arrives: `skip` (a quick fade and settle with its content staggering in, at the
 * intro's reveal as its light fades, or at once when the intro was skipped), `fade` (Reduce
 * Motion: a cross-fade, no stagger) or `resume` (a resumed guide: the whole card fades in place
 * with the stage, as it faded out when the guide closed).
 */
export type CardEntrance = 'skip' | 'fade' | 'resume';

/** The card's own arrival from `from`; its content groups follow `revealVariants`. */
const ARRIVAL = {
  skip: { from: { opacity: 0, scale: 0.98 }, transition: STEP_SPRING },
  fade: { from: { opacity: 0, scale: 0.98 }, transition: { duration: 0.4, ease: 'easeInOut' } },
  resume: { from: { opacity: 0 }, transition: STAGE_FADE },
} as const satisfies Record<CardEntrance, { from: object; transition: object }>;

/**
 * The step slide, by direction (1 forward, -1 back): the new step comes in from the side it lies
 * on and the old one leaves the other way. Under Reduce Motion both cross-fade.
 */
function stepVariants(reduced: boolean): Variants {
  return {
    enter: (direction: number) =>
      reduced ? { opacity: 0 } : { opacity: 0, x: direction * STEP_OFFSET },
    center: { opacity: 1, x: 0 },
    exit: (direction: number) =>
      reduced ? { opacity: 0 } : { opacity: 0, x: -direction * STEP_OFFSET },
  };
}

/**
 * The card's content groups (top bar, step, footer, art) staggering in after the surface; a
 * resumed card shows them with the surface.
 */
function revealVariants(entrance: CardEntrance): { group: Variants; item: Variants } {
  if (entrance === 'resume') {
    return { group: { cardHidden: {}, cardShown: {} }, item: { cardHidden: {}, cardShown: {} } };
  }
  const stagger = entrance === 'fade' ? 0 : INTRO.contentStagger;
  return {
    group: {
      cardHidden: {},
      cardShown: {
        transition: { staggerChildren: stagger },
      },
    },
    item: {
      cardHidden: entrance === 'fade' ? { opacity: 0 } : { opacity: 0, y: 8 },
      cardShown: { opacity: 1, y: 0, transition: entrance === 'fade' ? FADE : STEP_SPRING },
    },
  };
}

/**
 * The guide's card, centered over the scrim: the left column holds the top bar (progress, music,
 * close), the current step in a bounded scrolling body and the footer (Back, Later, the primary
 * action); the right column is the inset art panel. Below 760px of card width it stacks, art on
 * top. The surface is the panel's fill and shadow; the shell lays the window glass under it.
 *
 * Gating: on a goal step whose goal is unmet the primary is disabled (the footer says why) and
 * Later moves on; Return runs the primary only once settled and enabled. The finish step's primary
 * closes the guide and summons the panel.
 *
 * Until it starts closing the shell lays the window glass under the surface, from the moment its
 * entrance comes to rest.
 */
export function OnboardingCard({
  snapshot,
  goals,
  music,
  entrance,
  settled,
  closing,
  flow,
  onClose,
}: {
  snapshot: SettingsSnapshot | null;
  goals: OnboardingGoals;
  music: OnboardingMusic;
  entrance: CardEntrance;
  settled: boolean;
  closing: boolean;
  flow: ReturnType<typeof useOnboardingFlow>;
  onClose: (summon: boolean) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const viewport = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  // From the card's first moment: the glass moves to it as soon as its entrance comes to rest,
  // taking over from the opening page's, and fades out with the stage as the guide closes.
  useNativeSurface(surface, !closing, CARD_RADIUS, STAGE_FADE_DURATION);
  const pending = isGoalPending(flow.step, goals);
  // Once the card is at rest every step's heading takes focus as it appears, so keyboard and
  // VoiceOver users start reading the step (the first one included, after the intro).
  const view = useStepView(flow.step, {
    snapshot,
    goals,
    focusHeading: settled,
    atRest: settled && !closing,
    saveProgress: flow.saveProgress,
    goTo: flow.goToStep,
  });
  const announcement = useStepAnnouncement(flow.index, flow.moved);

  // Each step opens at its top, whatever the last one was scrolled to.
  useLayoutEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [flow.index]);

  const primary = () => {
    if (pending) return;
    if (flow.isLast) onClose(true);
    else flow.next();
  };
  usePrimaryShortcut(primary, settled && !closing && !pending);

  const reveal = revealVariants(entrance);
  return (
    <motion.main
      className="onboarding-card"
      data-step={flow.step}
      initial={ARRIVAL[entrance].from}
      animate={{ opacity: 1, scale: 1 }}
      transition={ARRIVAL[entrance].transition}
    >
      <div ref={surface} aria-hidden className="onboarding-card-surface" />
      <motion.div
        className="onboarding-card-layout"
        variants={reveal.group}
        initial="cardHidden"
        animate="cardShown"
      >
        <div className="onboarding-card-main">
          <motion.header className="onboarding-card-topbar" variants={reveal.item}>
            <OnboardingProgress
              index={flow.index}
              furthest={flow.furthest}
              goals={goals}
              onSelect={flow.goTo}
            />
            <MusicToggle music={music} />
            <CloseButton onClose={() => onClose(false)} />
          </motion.header>
          <motion.div className="onboarding-card-body" variants={reveal.item}>
            <ScrollArea className="onboarding-card-scroll" viewportRef={viewport} scrollShadow>
              <div className="onboarding-card-steps">
                <AnimatePresence initial={false} mode="popLayout" custom={flow.direction}>
                  <motion.div
                    key={flow.step}
                    className="onboarding-card-slide"
                    custom={flow.direction}
                    variants={stepVariants(reduced)}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={reduced ? FADE : STEP_SPRING}
                  >
                    {view.content}
                  </motion.div>
                </AnimatePresence>
              </div>
            </ScrollArea>
          </motion.div>
          <motion.div variants={reveal.item}>
            <OnboardingFooter
              showBack={flow.index > 0}
              pending={pending}
              primaryLabel={view.primaryLabel}
              onBack={flow.back}
              onLater={flow.next}
              onPrimary={primary}
            />
          </motion.div>
        </div>
        <motion.div className="onboarding-card-art-cell" variants={reveal.item}>
          <OnboardingCardArt
            step={flow.step}
            art={view.art}
            isContent={view.artIsContent === true}
          />
        </motion.div>
      </motion.div>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </motion.main>
  );
}
