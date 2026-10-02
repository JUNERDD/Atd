import { memo, useState } from 'react';
import { Bot, ListTodo, PenLine, Search, Sparkles, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { Artifact, FileRef } from '../../../client/agent/task-schema';
import { TaskFiles } from '../task-files';
import { ActivityRow } from './activity-row';
import type { AdaptedItem } from './adapter';
import { type ActivityPhase, type ActivityPhaseKind } from './phases';
import { phaseTitle, phaseToggleLabel } from './phase-title';
import { PhaseHeader, PhaseRail } from './phase-rail';
import { usePhaseMotion, visiblePhaseSteps } from './phase-reveal';
import type { RequestIndex } from './turns';

/** What the group was for, at a glance: look, change, run, plan, think. */
function PhaseGlyph({ kind }: { kind: ActivityPhaseKind }) {
  const props = { className: 'phase-icon', strokeWidth: 1.75 };
  switch (kind) {
    case 'edit':
      return <PenLine {...props} />;
    case 'research':
      return <Search {...props} />;
    case 'run':
      return <Terminal {...props} />;
    case 'agent':
      return <Bot {...props} />;
    case 'plan':
      return <ListTodo {...props} />;
    case 'think':
      return <Sparkles {...props} />;
    case 'other':
      return <Wrench {...props} />;
  }
}

/**
 * One phase: a header the whole group hangs off, and the steps under it on a rail. The header
 * always carries the group's tally; while running it grows under a shimmer instead of switching
 * to the latest step. Groups start collapsed unless a step is waiting on the user, which opens
 * its group by default. The toggle always wins after that: a collapsed or expanded group stays
 * put across new steps, phase switches, and settling. A collapsed live group keeps its newest two
 * steps in view under the header; once it settles only the header stays.
 */
function ActivityPhaseView({
  phase,
  active,
  requests,
}: {
  phase: ActivityPhase;
  active: boolean;
  requests: RequestIndex;
}) {
  const { t } = useTranslation('tasks');
  const [override, setOverride] = useState<boolean | null>(null);
  const { motion, header, arm } = usePhaseMotion(active);
  const waiting = phase.steps.some((step) => step.approvalPending);
  // The manual toggle wins over the waiting default: once touched, the group stays put across
  // new steps, phase switches, and settling — nothing reopens or snap-shuts behind the user.
  const open = override ?? waiting;
  const title = phaseTitle(phase, active, t);
  // A lone call the agent never introduced is not a group: a header repeating the single row
  // under it says nothing twice. It renders through the same rail as a group, so the step keeps
  // its state when a second step arrives and the header grows in above it.
  const grouped = phase.steps.length !== 1;
  const first = phase.steps[0];
  // Thinking, tool, and question steps already render their own leading icon, so an outer phase
  // glyph would double it (two Sparkles for a lone thought, two Terminals for a lone bash). Only
  // a lone step without an inner icon keeps the outer glyph as its sole marker.
  const innerHasIcon =
    first?.role === 'reasoning' || first?.role === 'tool' || first?.role === 'question';
  const marker = grouped || innerHasIcon ? null : <PhaseGlyph kind={phase.kind} />;

  // The outer Title already carries `phase-title` (truncation included): repeating it on the
  // inner span would put `overflow: hidden` on the live Shimmer's inline box, moving its
  // baseline to the bottom edge and shifting the text off the icon center.
  const label = active ? (
    <Shimmer as="span">{title}</Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and only the answer
    // reads at full strength.
    <span>{title}</span>
  );

  const toggle = phaseToggleLabel(open, phase.steps.length, t);
  return (
    <ActivityRow.Root
      open={open}
      onOpenChange={(next) => {
        arm();
        setOverride(next);
      }}
      status={active ? 'running' : 'completed'}
      className="phase-group"
    >
      <PhaseHeader show={grouped} animated={header}>
        <ActivityRow.Trigger aria-label={`${toggle}, ${title}`} className="phase-trigger">
          <ActivityRow.Icon>
            <PhaseGlyph kind={phase.kind} />
          </ActivityRow.Icon>
          <ActivityRow.Title className="phase-title" title={title}>
            {label}
          </ActivityRow.Title>
        </ActivityRow.Trigger>
      </PhaseHeader>
      <PhaseRail
        steps={visiblePhaseSteps(phase.steps, { grouped, open, active })}
        lone={!grouped}
        marker={marker}
        motion={motion}
        // A collapsed live group is the peek window: its steps trade places at a fixed height.
        mode={grouped && !open && active ? 'peek' : 'flow'}
        requests={requests}
      />
    </ActivityRow.Root>
  );
}

/** Memoized: the adapter keeps a group's object while its steps and requests are unchanged. */
export const ActivityGroup = memo(function ActivityGroup({
  item,
  requests,
  artifacts,
  anchors,
  onAttach,
  active,
}: {
  item: Extract<AdaptedItem, { type: 'activity' }>;
  requests: RequestIndex;
  artifacts: Artifact[];
  anchors: Set<string>;
  onAttach: (file: FileRef) => void;
  /** The round of work is still going: the tally shimmers and a collapsed group peeks its newest steps. */
  active: boolean;
}) {
  const files = anchors.has(item.anchorBlockId)
    ? artifacts.filter((file) => file.runId === item.anchorRunId)
    : [];
  return (
    <div className="activity-group" data-activity={item.live ? 'live' : 'settled'}>
      <ActivityPhaseView phase={item.phase} active={active} requests={requests} />
      {files.length > 0 && <TaskFiles files={files} onAttach={onAttach} />}
    </div>
  );
});
