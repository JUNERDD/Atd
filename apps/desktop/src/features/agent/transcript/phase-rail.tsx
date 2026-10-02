import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@atd/ui/lib/utils';
import { ActivityRow } from './activity-row';
import type { ViewBlock } from './adapter';
import { PhaseStep } from './phase-step';
import { usePhaseReveal, type PhaseMotion, type RevealMode } from './phase-reveal';
import type { RequestIndex } from './turns';

/** A rail step that can grow in and collapse out; keeps the `ActivityRow.Step` anatomy. */
const MotionStep = motion.create(ActivityRow.Step);

/** The header wrapper with presence: it grows in above a live lone step once a second arrives. */
function AnimatedHeader({ show, children }: { show: boolean; children: ReactNode }) {
  const reveal = usePhaseReveal();
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="header"
          className="phase-header"
          variants={reveal}
          initial="hidden"
          animate="shown"
          exit="hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The group header. Only a phase live at mount can watch its header appear, so only that one
 * pays for presence; `initial={false}` keeps a header already there from replaying.
 */
export function PhaseHeader({
  show,
  animated,
  children,
}: {
  show: boolean;
  animated: boolean;
  children: ReactNode;
}) {
  if (animated) return <AnimatedHeader show={show}>{children}</AnimatedHeader>;
  return show ? <div className="phase-header">{children}</div> : null;
}

type StepsProps = {
  steps: ViewBlock[];
  lone: boolean;
  marker: ReactNode;
  requests: RequestIndex;
};

function stepClass(lone: boolean, marker: ReactNode) {
  return cn(lone && 'phase-step-lone', lone && marker && 'phase-step-marked');
}

/** Plain steps for a phase with motion off: no presence, no motion values. */
function StaticSteps({ steps, lone, marker, requests }: StepsProps) {
  return steps.map((step) => (
    <ActivityRow.Step key={step.id} className={stepClass(lone, marker)}>
      {lone && marker}
      <PhaseStep view={step} requests={requests} />
    </ActivityRow.Step>
  ));
}

/**
 * Steps entering the visible window grow in and steps leaving it collapse out, each its own small
 * box: only that step's height and opacity move, never the whole body's.
 */
function AnimatedSteps({
  steps,
  lone,
  marker,
  requests,
  replay,
  mode,
}: StepsProps & { replay: boolean; mode: RevealMode }) {
  const reveal = usePhaseReveal();
  // `custom` reaches leaving steps through the presence, so a step that leaves resolves its exit
  // with the mode of the render that removed it.
  return (
    <AnimatePresence initial={replay} custom={mode}>
      {steps.map((step) => (
        <MotionStep
          key={step.id}
          className={stepClass(lone, marker)}
          variants={reveal}
          custom={mode}
          initial="hidden"
          animate="shown"
          exit="leave"
        >
          {lone && marker}
          <PhaseStep view={step} requests={requests} />
        </MotionStep>
      ))}
    </AnimatePresence>
  );
}

/**
 * The phase body: one keyed list at one tree position for every state (lone, peek, open, settled),
 * so a step that stays in view never remounts and keeps its own expanded state. A lone step drops
 * the rail (its indent and lines ease in when the group forms) and, when its block has no icon of
 * its own, carries the phase glyph as `marker` in the indent. `motion` picks plain or animated
 * steps (see `PhaseMotion`); an armed phase animates the steps that appear with it.
 */
export function PhaseRail({
  motion,
  mode,
  ...props
}: StepsProps & { motion: PhaseMotion; mode: RevealMode }) {
  return (
    <ActivityRow.Region className="phase-body">
      <ActivityRow.Steps>
        {motion === 'off' ? (
          <StaticSteps {...props} />
        ) : (
          <AnimatedSteps {...props} replay={motion === 'armed'} mode={mode} />
        )}
      </ActivityRow.Steps>
    </ActivityRow.Region>
  );
}
