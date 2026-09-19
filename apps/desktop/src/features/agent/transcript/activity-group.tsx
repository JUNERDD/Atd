import { useLayoutEffect, useRef, useState, type UIEvent, type WheelEvent } from 'react';
import { Bot, PenLine, Search, Sparkles, Terminal, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { Artifact, FileRef } from '../../../../electron/agent/task-schema';
import { TaskFiles } from '../task-files';
import { ActivityRow } from './activity-row';
import type { AdaptedItem, ViewBlock } from './adapter';
import { type ActivityPhase, type ActivityPhaseKind } from './phases';
import { latestStepTitle, phaseTitle, phaseToggleLabel } from './phase-title';
import { PhaseStep } from './phase-step';
import type { RequestIndex } from './turns';

/** What the group was for, at a glance: look, change, run, think. */
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
    case 'think':
      return <Sparkles {...props} />;
    case 'other':
      return <Wrench {...props} />;
  }
}

/**
 * Keeps a live phase body on its newest step. Pinning happens in layout before paint so the
 * window follows without a visible hitch; only a real wheel away from the bottom pauses that.
 */
function useLivePhasePin(active: boolean, steps: ViewBlock[]) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!active || !node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [active, steps]);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (node.scrollHeight - node.scrollTop - node.clientHeight <= 16) stick.current = true;
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY >= 0) return;
    const node = event.currentTarget;
    if (node.scrollHeight <= node.clientHeight + 1) return;
    stick.current = false;
    event.stopPropagation();
  };

  return { ref, onScroll, onWheel };
}

/**
 * One phase: a header the whole group hangs off, and the steps under it on a rail. Groups stay
 * collapsed — while running the header shows only the latest step, and finishing a phase snaps
 * it shut behind the tally summary — until clicked, after which it stays put for the rest of the
 * run. A step still waiting on the user keeps the group open regardless. While live, the open
 * body stays a short scrolling window pinned to the newest step; after the turn settles an
 * opened group is full height again.
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
  const waiting = phase.steps.some((step) => step.approvalPending);
  // A finished phase forgets a manual expand, so it snaps shut behind its summary. Adjusted
  // during render (not in an effect) so no extra render pass is scheduled.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setOverride(null);
  }
  const open = waiting || override === true;
  const { ref, onScroll, onWheel } = useLivePhasePin(active && open, phase.steps);
  const last = phase.steps.at(-1);
  const title = active && last ? latestStepTitle(last, t) : phaseTitle(phase, active, t);
  const first = phase.steps[0];
  const single = phase.steps.length === 1 && first ? first : undefined;

  // A lone call the agent never introduced is not a group: a header repeating the single row
  // under it says nothing twice. Thinking and tool steps already render their own leading icon,
  // so an outer phase glyph would double it (two Sparkles for a lone thought, two Terminals for
  // a lone bash). Only steps without an inner icon keep the outer glyph as their sole marker.
  if (single) {
    const innerHasIcon = single.role === 'reasoning' || single.role === 'tool';
    if (innerHasIcon) {
      return (
        <div className="phase-single">
          <div className="phase-single-step">
            <PhaseStep view={single} requests={requests} />
          </div>
        </div>
      );
    }
    return (
      <div className="phase-single">
        <PhaseGlyph kind={phase.kind} />
        <div className="phase-single-step">
          <PhaseStep view={single} requests={requests} />
        </div>
      </div>
    );
  }

  const label = active ? (
    <Shimmer as="span" className="phase-title">
      {title}
    </Shimmer>
  ) : (
    // Dimmed to sit with the icons: the work is chrome around the answer, and only the answer
    // reads at full strength.
    <span className="phase-title" title={title}>
      {title}
    </span>
  );

  const toggle = phaseToggleLabel(open, phase.steps.length, t);
  return (
    <ActivityRow.Root
      open={open}
      onOpenChange={setOverride}
      status={active ? 'running' : 'completed'}
      className="phase-group"
    >
      <ActivityRow.Trigger aria-label={`${toggle}, ${title}`} className="phase-trigger">
        <ActivityRow.Icon>
          <PhaseGlyph kind={phase.kind} />
        </ActivityRow.Icon>
        <ActivityRow.Title className="phase-title" title={title}>
          {label}
        </ActivityRow.Title>
      </ActivityRow.Trigger>
      <ActivityRow.Content>
        <ScrollArea
          viewportRef={ref}
          viewportProps={{ onScroll, onWheel }}
          className="phase-scroll"
          scrollShadow
        >
          <ActivityRow.Steps>
            {phase.steps.map((step) => (
              <ActivityRow.Step key={step.id} className={active ? 'step-in' : ''}>
                <PhaseStep view={step} requests={requests} />
              </ActivityRow.Step>
            ))}
          </ActivityRow.Steps>
        </ScrollArea>
      </ActivityRow.Content>
    </ActivityRow.Root>
  );
}

export function ActivityGroup({
  item,
  requests,
  artifacts,
  anchors,
  onAttach,
  done,
}: {
  item: Extract<AdaptedItem, { type: 'activity' }>;
  requests: RequestIndex;
  artifacts: Artifact[];
  anchors: Set<string>;
  onAttach: (file: FileRef) => void;
  done: boolean;
}) {
  const files = anchors.has(item.anchorBlockId)
    ? artifacts.filter((file) => file.runId === item.anchorRunId)
    : [];
  return (
    <div className="activity-group" data-activity={item.live ? 'live' : 'settled'}>
      <div className="activity-phases">
        {item.phases.map((phase, index) => (
          <ActivityPhaseView
            key={phase.id || `${item.id}-${index}`}
            phase={phase}
            active={!done && index === item.phases.length - 1}
            requests={requests}
          />
        ))}
      </div>
      {files.length > 0 && <TaskFiles files={files} onAttach={onAttach} />}
    </div>
  );
}
