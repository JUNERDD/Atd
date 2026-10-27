import { CalendarClock, CornerDownRight, SquarePen, type LucideIcon } from 'lucide-react';
import type { NextStepKind } from '@atd/agent-contracts';

/** Each kind's mark on the card and in its dialog: where the suggestion leads. */
export const NEXT_STEP_ICONS: Record<NextStepKind, LucideIcon> = {
  continue: CornerDownRight,
  newTask: SquarePen,
  automation: CalendarClock,
};
