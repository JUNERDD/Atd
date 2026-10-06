import {
  CalendarClock,
  CircleCheck,
  CircleMinus,
  CircleSlash,
  CircleStop,
  CircleX,
  FolderSync,
  LoaderCircle,
  SkipForward,
  TimerOff,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import type { AutomationOutcome, AutomationTrigger } from '@atd/agent-contracts';

/** A run's outcome as an icon; its row's tone (`data-tone`) colors it, the text says what it is. */
export function OutcomeIcon({ outcome }: { outcome: AutomationOutcome }) {
  switch (outcome) {
    case 'running':
      return (
        <LoaderCircle aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
      );
    case 'delivered':
      return <CircleCheck aria-hidden="true" />;
    case 'nothingNew':
      return <CircleMinus aria-hidden="true" />;
    case 'needsAttention':
      return <TriangleAlert aria-hidden="true" />;
    case 'failed':
      return <CircleX aria-hidden="true" />;
    case 'timedOut':
      return <TimerOff aria-hidden="true" />;
    case 'stopped':
      return <CircleStop aria-hidden="true" />;
    case 'interrupted':
      return <CircleSlash aria-hidden="true" />;
    case 'skipped':
      return <SkipForward aria-hidden="true" />;
  }
}

/** What starts the automation, as the list row's icon: a schedule, a folder, another automation. */
export function TriggerIcon({ kind }: { kind: AutomationTrigger['kind'] }) {
  switch (kind) {
    case 'schedule':
      return <CalendarClock aria-hidden="true" />;
    case 'folder':
      return <FolderSync aria-hidden="true" />;
    case 'automation':
      return <Workflow aria-hidden="true" />;
  }
}
