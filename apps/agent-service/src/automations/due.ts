import type { Automation } from '@atd/agent-contracts';
import type { AutomationState } from './files.js';
import { freshCursor, scheduleClock } from './schedule.js';

/**
 * What a schedule trigger should do at a tick (decision D6). The tick compares the wall clock
 * with the persisted next-due occurrence; when it passed, the latest occurrence up to now is the
 * one served, so any earlier ones fold into it. An occurrence a regular tick finds is on time,
 * however late that tick came. Later than a regular tick gap the occurrence was missed (Atd was
 * closed, the Mac slept, the clock jumped): after the wake grace it fires once, marked late, when
 * the automation runs missed runs and the occurrence is at most seven days old, and is skipped
 * otherwise.
 */

/** How often the engine ticks. */
export const TICK_MS = 30_000;
/** A tick this much later than the last one means the Mac slept or the clock jumped. */
export const JUMP_MS = 3 * TICK_MS;
/** Lateness that still counts as on time: whatever a tick that came no later than that finds. */
export const ON_TIME_MS = JUMP_MS;
/** The oldest missed occurrence a `runOnce` automation still runs. */
export const CATCH_UP_MS = 7 * 24 * 60 * 60_000;

export type Due =
  | { action: 'none' }
  /** A missed occurrence waits for the wake grace to pass. */
  | { action: 'wait' }
  | { action: 'fire'; occurrence: number; late: boolean }
  | { action: 'skip'; occurrence: number; reason: 'missed' | 'paused' };

export function scheduleDue(
  automation: Automation,
  state: AutomationState | undefined,
  now: number,
  options: { paused: boolean; graceUntil: number },
): Due {
  const { trigger } = automation;
  if (trigger.kind !== 'schedule' || !state?.nextDueAt) return { action: 'none' };
  const due = Date.parse(state.nextDueAt);
  if (!(due <= now)) return { action: 'none' };
  const anchor = state.anchor ? Date.parse(state.anchor) : due;
  const latest = scheduleClock(trigger.schedule, trigger.timezone, anchor).latest(now);
  const occurrence = Math.max(due, latest ?? due);
  if (options.paused) return { action: 'skip', occurrence, reason: 'paused' };
  if (now - occurrence <= ON_TIME_MS) return { action: 'fire', occurrence, late: false };
  if (now < options.graceUntil) return { action: 'wait' };
  if (automation.policy.missedRuns === 'runOnce' && now - occurrence <= CATCH_UP_MS)
    return { action: 'fire', occurrence, late: true };
  return { action: 'skip', occurrence, reason: 'missed' };
}

/**
 * Whether an enabled schedule lost its cursor (its state was reset): the engine then starts
 * counting from `now`, as when the automation was turned on.
 */
export function needsCursor(automation: Automation, state: AutomationState | undefined): boolean {
  const { trigger } = automation;
  if (!automation.enabled || trigger.kind !== 'schedule' || state?.nextDueAt) return false;
  // A one-time schedule without a cursor was served; settling turns it off.
  return trigger.schedule.kind !== 'once' || !state;
}

/** The cursor an automation turned on at `now` starts with (see `freshCursor`). */
export function startCursor(automation: Automation, state: AutomationState, now: number): void {
  const cursor = freshCursor(automation.trigger, now);
  delete state.nextDueAt;
  delete state.anchor;
  Object.assign(state, cursor);
}

/**
 * After the wall clock went back to `now`: an interval counts from `now` at the latest, and the
 * next occurrence comes no later than the next one from `now`.
 */
export function rewindCursor(automation: Automation, state: AutomationState, now: number): void {
  const { trigger } = automation;
  if (!automation.enabled || trigger.kind !== 'schedule' || !state.nextDueAt) return;
  if (state.anchor && Date.parse(state.anchor) > now) state.anchor = new Date(now).toISOString();
  const anchor = state.anchor ? Date.parse(state.anchor) : now;
  const next = scheduleClock(trigger.schedule, trigger.timezone, anchor).next(now);
  if (next !== null && next < Date.parse(state.nextDueAt))
    state.nextDueAt = new Date(next).toISOString();
}
