import type {
  Automation,
  AutomationFireSource,
  AutomationOutcome,
  AutomationRun,
  AutomationRunReason,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import {
  AUTOMATION_FIRES_PER_HOUR,
  emptyAutomationState,
  pushRun,
  replaceRun,
  type AutomationState,
} from './files.js';
import { isFailure, liveNotices, makeNotice, noticeKind, type Classified } from './outcome.js';
import { scheduleClock } from './schedule.js';
import type { AutomationData } from './store.js';

/**
 * Run-record bookkeeping on a store draft: the durable receipt of a fire with its schedule cursor
 * (decision D6), the skips it turns into, and how a finished run settles its record, failure
 * count, auto-pause and notices (decisions D4, D5, D7). Pure functions over the draft, so every
 * decision lands in the same write as the record it explains.
 */

/** Failed runs in a row that turn an automation off (decision D7). */
export const FAILURES_TO_PAUSE = 3;
const HOUR_MS = 60 * 60_000;

/** One fire as the engine asks for it. */
export interface FireRequest {
  source: AutomationFireSource;
  /** Schedule triggers: the occurrence served. */
  scheduledFor?: number;
  late?: boolean;
  /** Folder triggers: the files that fired it, relative to the watched folder. */
  files?: readonly string[];
}

export function stateOf(draft: AutomationData, automationId: string): AutomationState {
  const existing = draft.state.automations[automationId];
  if (existing) return existing;
  const created = emptyAutomationState();
  draft.state.automations[automationId] = created;
  return created;
}

/** Whether the automation has a run that has not ended: waiting for a slot, starting or running. */
export function hasActiveRun(state: AutomationState | undefined): boolean {
  return state?.runs.some((run) => run.outcome === 'running') ?? false;
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

/**
 * Moves a schedule's cursor past `occurrence`: to the first occurrence after it and after `now`.
 * A fire of an interval restarts its count there; a skip keeps the count it had.
 */
export function advanceSchedule(
  automation: Automation,
  state: AutomationState,
  occurrence: number,
  now: number,
  fired: boolean,
): void {
  const { trigger } = automation;
  if (trigger.kind !== 'schedule') return;
  if (fired && trigger.schedule.kind === 'interval') state.anchor = iso(occurrence);
  const anchor = state.anchor ? Date.parse(state.anchor) : now;
  const next = scheduleClock(trigger.schedule, trigger.timezone, anchor).next(
    Math.max(occurrence, now),
  );
  if (next === null) delete state.nextDueAt;
  else state.nextDueAt = iso(next);
}

function baseRecord(
  automationId: string,
  recordId: string,
  request: FireRequest,
  now: number,
): Omit<AutomationRun, 'outcome'> {
  return {
    id: recordId,
    automationId,
    source: request.source,
    ...(request.scheduledFor !== undefined ? { scheduledFor: iso(request.scheduledFor) } : {}),
    firedAt: iso(now),
    ...(request.late ? { late: true as const } : {}),
    ...(request.files?.length ? { files: [...request.files] } : {}),
  };
}

/**
 * Records a skipped occurrence, already read, and answers the record that stands for it. A skip
 * for the global pause or the rate limit joins the newest record when that is the same skip, so a
 * long pause or a busy folder leaves one record instead of flooding the history.
 */
export function recordSkip(
  state: AutomationState,
  automationId: string,
  reason: AutomationRunReason,
  request: FireRequest,
  now: number,
  recordId: string,
): AutomationRun {
  const newest = state.runs[0];
  const coalesce = reason === 'paused' || reason === 'rateLimited';
  if (coalesce && newest?.outcome === 'skipped' && newest.reason === reason) return newest;
  const record: AutomationRun = {
    ...baseRecord(automationId, recordId, request, now),
    outcome: 'skipped',
    reason,
    finishedAt: iso(now),
    readAt: iso(now),
  };
  pushRun(state, record);
  return record;
}

/**
 * Skips a fire: records it, moves a schedule's cursor past the occurrence and, when that was a
 * one-time schedule's only occurrence, turns the automation off as finished.
 */
export function skipFire(
  draft: AutomationData,
  automation: Automation,
  reason: AutomationRunReason,
  request: FireRequest,
  now: number,
  recordId: string,
): AutomationRun {
  const state = stateOf(draft, automation.id);
  const record = recordSkip(state, automation.id, reason, request, now, recordId);
  if (request.scheduledFor !== undefined) {
    advanceSchedule(automation, state, request.scheduledFor, now, false);
    finishOnce(draft, automation, now);
  }
  return record;
}

function rateLimited(state: AutomationState, now: number): boolean {
  state.recentFires = state.recentFires.filter((at) => now - Date.parse(at) < HOUR_MS);
  return state.recentFires.length >= AUTOMATION_FIRES_PER_HOUR;
}

/**
 * The durable receipt of a fire (decision D6): the record, `running` until its task run ends, and
 * the advanced schedule cursor, written before anything is submitted. A fire the automation cannot
 * take becomes a skip: everything is paused, its previous run is still going (`overlap`, except
 * that Run now answers 409 and a folder keeps its files waiting), or too many trigger fires
 * happened this hour. Answers the record, and whether it fired; null when a folder's files stay
 * pending or the automation was turned off.
 */
export function recordFire(
  draft: AutomationData,
  automation: Automation,
  request: FireRequest,
  now: number,
  recordId: string,
): { record: AutomationRun; fired: boolean } | null {
  const state = stateOf(draft, automation.id);
  const manual = request.source === 'manual';
  const skip = (reason: AutomationRunReason) => ({
    record: skipFire(draft, automation, reason, request, now, recordId),
    fired: false,
  });
  // Checked again in the write: a fire decided before the automation was turned off or every
  // automation was paused does not start. Run now does, whatever the switch and the pause.
  if (!manual && !automation.enabled) return null;
  if (!manual && draft.definitions.paused) return skip('paused');
  if (hasActiveRun(state)) {
    if (manual) throw new ConflictError('The automation is already running.');
    return request.source === 'folder' ? null : skip('overlap');
  }
  if (!manual && rateLimited(state, now)) return skip('rateLimited');
  const record: AutomationRun = {
    ...baseRecord(automation.id, recordId, request, now),
    outcome: 'running',
  };
  pushRun(state, record);
  if (!manual) state.recentFires.push(iso(now));
  if (request.scheduledFor !== undefined)
    advanceSchedule(automation, state, request.scheduledFor, now, true);
  else if (manual && automation.trigger.kind === 'schedule')
    // A run now restarts an interval's count, so the next scheduled run does not follow at once.
    advanceSchedule(automation, state, now, now, true);
  return { record, fired: true };
}

/**
 * What a finished run settles with. `read`: the record has nothing to open (a memory
 * consolidation starts no task), so it is recorded as read whatever its result.
 */
export type Settlement = Classified & { declined?: number; read?: true };

/** Turns the automation off with a reason, as a definitions change. */
function pause(automation: Automation, now: number): void {
  automation.enabled = false;
  automation.revision += 1;
  automation.updatedAt = iso(now);
}

/**
 * Settles a run record with its result: failures count toward the auto-pause (three in a row
 * turn the automation off and post one `paused` notice), a one-time schedule's run turns it off
 * as finished, and the result posts its notice. Answers the settled record; null when the record
 * or its automation is gone.
 */
export function settleRun(
  draft: AutomationData,
  automationId: string,
  recordId: string,
  result: Settlement,
  now: number,
): AutomationRun | null {
  const automation = draft.definitions.automations.find((item) => item.id === automationId);
  const state = draft.state.automations[automationId];
  const record = state?.runs.find((run) => run.id === recordId);
  if (!automation || !state || !record || record.outcome !== 'running') return null;
  const { outcome } = result;
  const settled: AutomationRun = {
    ...record,
    outcome,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.detail ? { detail: result.detail } : {}),
    ...(result.summary ? { summary: result.summary } : {}),
    ...(result.declined ? { declined: result.declined } : {}),
    finishedAt: iso(now),
    // A run that found nothing new is silent, a skip or a consolidation has nothing to open: read.
    ...(result.read || outcome === 'nothingNew' || outcome === 'skipped'
      ? { readAt: iso(now) }
      : {}),
  };
  replaceRun(state, settled);
  const notices = [];
  const kind = noticeKind(outcome, automation.delivery.notify);
  if (kind) notices.push(makeNotice(automation, kind, settled, now));
  if (isFailure(outcome)) state.consecutiveFailures += 1;
  else if (succeeded(outcome)) state.consecutiveFailures = 0;
  if (state.consecutiveFailures >= FAILURES_TO_PAUSE && automation.enabled) {
    pause(automation, now);
    state.pausedReason = 'failures';
    notices.push(makeNotice(automation, 'paused', settled, now));
  }
  const { trigger } = automation;
  const once = trigger.kind === 'schedule' && trigger.schedule.kind === 'once';
  if (once && record.source === 'schedule' && automation.enabled) {
    pause(automation, now);
    state.pausedReason = 'finished';
  }
  draft.state.notices = liveNotices([...draft.state.notices, ...notices], now);
  return settled;
}

function succeeded(outcome: AutomationOutcome): boolean {
  return outcome === 'delivered' || outcome === 'nothingNew' || outcome === 'needsAttention';
}

/** A one-time schedule whose occurrence was skipped is done as well. */
export function finishOnce(draft: AutomationData, automation: Automation, now: number): void {
  const live = draft.definitions.automations.find((item) => item.id === automation.id);
  const { trigger } = automation;
  if (!live?.enabled || trigger.kind !== 'schedule' || trigger.schedule.kind !== 'once') return;
  pause(live, now);
  stateOf(draft, automation.id).pausedReason = 'finished';
}
