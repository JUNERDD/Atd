import type { Automation, AutomationRun } from '@atd/agent-contracts';
import type { AutomationState } from './files.js';
import { hasActiveRun } from './records.js';
import { wallClock } from './schedule.js';

/**
 * When an idle trigger fires: at most once per calendar day in its time zone, the first tick
 * after the wake grace at which the shell's latest report says the Mac has had no input for the
 * trigger's idle time and no run the person started is going. There is no catch-up: a day without
 * such a moment simply has no run. A global pause holds it off without recording anything.
 */

export interface IdleFacts {
  paused: boolean;
  graceUntil: number;
  /** Seconds since the person's last input; null when the shell's report is missing or stale. */
  idleSeconds: number | null;
  /** Active runs the person started (unattended.ts `attendedActiveRuns`). */
  attendedRuns: number;
}

/** `YYYY-MM-DD` of `time` in `timezone`. */
function calendarDay(time: number, timezone: string): string {
  return wallClock(time, timezone).slice(0, 10);
}

/**
 * Whether the record uses up its day: every idle run does except a skip that never reached the
 * action (the pause, an overlap, the rate limit). A consolidation that found memory learning
 * paused counts, so a paused memory is not asked again at every tick.
 */
function usesDay(run: AutomationRun): boolean {
  return run.source === 'idle' && (run.outcome !== 'skipped' || run.reason === 'memoryPaused');
}

export function idleDue(
  automation: Automation,
  state: AutomationState | undefined,
  now: number,
  facts: IdleFacts,
): boolean {
  const { trigger } = automation;
  if (trigger.kind !== 'idle' || facts.paused || now < facts.graceUntil) return false;
  if (facts.idleSeconds === null || facts.idleSeconds < trigger.idleMinutes * 60) return false;
  if (facts.attendedRuns > 0 || hasActiveRun(state)) return false;
  const today = calendarDay(now, trigger.timezone);
  return !(state?.runs ?? []).some(
    (run) => usesDay(run) && calendarDay(Date.parse(run.firedAt), trigger.timezone) === today,
  );
}
