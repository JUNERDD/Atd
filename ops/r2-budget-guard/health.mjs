// @ts-check

import { BILLING_CACHE_MAX_AGE } from './billing.mjs';

export const INVENTORY_INTERVAL = 60 * 60000;
export const PAUSED_CHECK_INTERVAL = 5 * 60000;
const PAUSED_IDLE_CHECK_INTERVAL = 60 * 60000;
const PAUSED_FAST_WINDOW = 30 * 60000;
const HEALTH_MAX_AGE = 5 * 60000;
const FAILURE_GRACE = 3 * 60000;

/** @typedef {{checkedAt: number, classA: number, classB: number, storageBytes: number, storageCheckedAt: number, billingPeriod: {start: string, end: string}}} HealthySnapshot */
/** @typedef {{checkedAt: number, nextCheckAt?: number, successes: number, periodKey?: string}} PausedCheck */
/** @typedef {{requestedAt: string, reasons: string[], usage: object}} PendingPause */
/** @typedef {import('./billing.mjs').BillingState & {lastHealthy?: HealthySnapshot, failureSince?: number, retryNotBefore?: number, lastFailure?: import('./api.mjs').RequestFailure, pausedSince?: number, pausedCheck?: PausedCheck, pendingPause?: PendingPause}} MonitorState */

/** Preserve the scheduled interval across restarts and legacy state upgrades.
 * @param {PausedCheck} check */
export function pausedCheckDueAt(check) {
  return check.nextCheckAt ?? check.checkedAt + PAUSED_CHECK_INTERVAL;
}

/** A closed bucket needs fewer inventories once recovery is established or slow.
 * @param {MonitorState} state @param {number} now @param {number} successes
 * @param {string} [periodKey] */
export function recordPausedCheck(state, now, successes, periodKey) {
  if (!Number.isFinite(state.pausedSince) || /** @type {number} */ (state.pausedSince) > now)
    state.pausedSince = now;
  const interval =
    successes >= 3 || now - /** @type {number} */ (state.pausedSince) >= PAUSED_FAST_WINDOW
      ? PAUSED_IDLE_CHECK_INTERVAL
      : PAUSED_CHECK_INTERVAL;
  const periodEnd = successes > 0 ? Date.parse(state.billing?.period.end ?? '') : NaN;
  state.pausedCheck = {
    checkedAt: now,
    nextCheckAt: Math.min(now + interval, periodEnd > now ? periodEnd : Infinity),
    successes,
    ...(periodKey ? { periodKey } : {}),
  };
}

/**
 * A short grace needs recent, complete evidence and at least 20% headroom
 * below every pause threshold. It never carries across a billing boundary.
 * @param {MonitorState} state
 * @param {{classA: number, classB: number, storageBytes: number}} limits
 * @param {number} now
 */
export function graceDeadline(state, limits, now) {
  const last = state.lastHealthy;
  if (!last || state.failureSince === undefined) return 0;
  if (
    ![last.checkedAt, last.storageCheckedAt, state.failureSince].every(
      (time) => Number.isFinite(time) && time <= now,
    )
  )
    return 0;
  if (
    !['classA', 'classB', 'storageBytes'].every((key) => {
      const k = /** @type {'classA'|'classB'|'storageBytes'} */ (key);
      return Number.isFinite(last[k]) && last[k] >= 0 && last[k] < limits[k] * 0.8;
    })
  )
    return 0;
  const periodStart = Date.parse(last.billingPeriod.start);
  const periodEnd = Date.parse(last.billingPeriod.end);
  if (!(periodStart <= last.checkedAt && now < periodEnd)) return 0;
  return Math.min(
    state.failureSince + FAILURE_GRACE,
    last.checkedAt + HEALTH_MAX_AGE,
    last.storageCheckedAt + INVENTORY_INTERVAL + HEALTH_MAX_AGE,
    periodEnd,
    state.billing ? state.billing.verifiedAt + BILLING_CACHE_MAX_AGE : Infinity,
  );
}
