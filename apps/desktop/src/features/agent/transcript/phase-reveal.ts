import { useState } from 'react';
import { useReducedMotion, type Variants } from 'motion/react';
import type { ViewBlock } from './adapter';

/*
 * What a phase reveals under its header, and how steps move in and out of that view. The rail
 * (`phase-rail.tsx`) renders it.
 */

/** How many of the newest steps a live, collapsed group keeps in view under its header. */
const PEEK_STEPS = 2;

/**
 * Which of a phase's steps show: every step while the group is open, the newest two while a live
 * group is collapsed (the window advances as steps arrive), and none once a collapsed group
 * settles. A lone step has no header to fold behind, so it always shows.
 */
export function visiblePhaseSteps(
  steps: ViewBlock[],
  { grouped, open, active }: { grouped: boolean; open: boolean; active: boolean },
): ViewBlock[] {
  if (!grouped || open) return steps;
  return active ? steps.slice(-PEEK_STEPS) : [];
}

/*
 * Reveal timing mirrors the leaf rows' `row-expand` / `row-collapse` keyframes in agent.css:
 * entering eases out over 240ms, leaving eases in over 200ms. Only height and opacity move — a
 * slide or blur would hitch the transcript's bottom-follow, which tracks height per frame.
 * Overflow clips only while the height moves, so focus rings are whole at rest.
 */
const ENTER = { duration: 0.24, ease: [0.22, 1, 0.36, 1] } as const;
const EXIT = { duration: 0.2, ease: [0.42, 0, 1, 1] } as const;
const INSTANT = { duration: 0 } as const;
/*
 * A live peek advancing swaps its oldest step for the newest in one frame. Both run on this one
 * curve, so the shrinking and growing heights always sum to the same window height: nothing
 * below the group moves, and the step between them glides up one row.
 */
const ADVANCE = { duration: 0.32, ease: [0.4, 0, 0.2, 1] } as const;

/**
 * How steps move. `flow` grows and collapses the body (expand, collapse, settle, a new step
 * appended to an open group); `peek` is the live peek window advancing, a fixed-height ticker.
 */
export type RevealMode = 'flow' | 'peek';

/*
 * The leaving step keeps its content on its bottom edge in a peek, so as its height closes the
 * content rides up and out of the window instead of being cut off from below; the entering step
 * keeps the default top anchor and rises in from the window's bottom edge.
 */
const ANCHOR_BOTTOM = { display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' };

function revealVariants(reduce: boolean): Variants {
  const timing = (mode: RevealMode | undefined, flow: typeof ENTER | typeof EXIT) =>
    reduce ? INSTANT : mode === 'peek' ? ADVANCE : flow;
  return {
    hidden: (mode?: RevealMode) => ({
      height: 0,
      opacity: 0,
      overflow: 'hidden',
      transition: timing(mode, EXIT),
    }),
    shown: (mode?: RevealMode) => ({
      height: 'auto',
      opacity: 1,
      transition: timing(mode, ENTER),
      transitionEnd: { overflow: 'visible' },
    }),
    leave: (mode?: RevealMode) => ({
      height: 0,
      opacity: 0,
      overflow: 'hidden',
      ...(mode === 'peek' && ANCHOR_BOTTOM),
      transition: timing(mode, EXIT),
    }),
  };
}

const REVEAL = revealVariants(false);
const REVEAL_REDUCED = revealVariants(true);

/**
 * The phase's reveal variants. `MotionConfig reducedMotion` would stop only the height and leave
 * the fade running; reduced motion swaps in instant transitions for both instead.
 */
export function usePhaseReveal(): Variants {
  return useReducedMotion() ? REVEAL_REDUCED : REVEAL;
}

/**
 * How much motion machinery a phase carries. Most groups in a long transcript are settled and
 * never move, so they render plain DOM (`off`). A group live at mount animates from then on
 * without replaying what is already shown (`mounted`); a settled group switches on (`armed`) the
 * first time the user toggles it or it goes live again, and the steps that appear with it animate
 * in. Once on it stays on: switching back would remount the steps and drop their state.
 */
export type PhaseMotion = 'off' | 'mounted' | 'armed';

export function usePhaseMotion(active: boolean) {
  const [motion, setMotion] = useState<PhaseMotion>(active ? 'mounted' : 'off');
  // The header only ever moves when a live lone step gains a second step. Fixed at mount: swapping
  // its wrapper later would remount the trigger under the user's pointer and drop its focus.
  const [header] = useState(active);
  if (active && motion === 'off') setMotion('armed');
  const arm = () => {
    if (motion === 'off') setMotion('armed');
  };
  return { motion, header, arm };
}
