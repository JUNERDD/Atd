// @ts-check
import { ApiRequestError, createRequest } from './api.mjs';
import { BillingUnavailableError, resolveBilling } from './billing.mjs';
import { disablePublicAccess, publicAccessState, publicEndpoints } from './public-access.mjs';
import {
  graceDeadline,
  PAUSED_CHECK_INTERVAL,
  pausedCheckDueAt,
  recordPausedCheck,
} from './health.mjs';
export { billingPeriod } from './billing.mjs';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
const FREE_ACTIONS = new Set([
  'DeleteObject',
  'DeleteObjects',
  'DeleteBucket',
  'AbortMultipartUpload',
]);
const CLASS_B_ACTIONS = new Set([
  'HeadBucket',
  'HeadObject',
  'GetObject',
  'UsageSummary',
  'GetBucketEncryption',
  'GetBucketLocation',
  'GetBucketCors',
  'GetBucketLifecycleConfiguration',
]);

/** @typedef {Omit<Env, 'MODE'> & {MODE: 'observe' | 'enforce'}} GuardEnv */

export class PauseFailedError extends Error {
  /** @param {string[]} reasons @param {object} usage @param {string} checkedAt */
  constructor(reasons, usage, checkedAt) {
    super('Could not verify that all configured public R2 entry points are disabled');
    this.name = 'PauseFailedError';
    this.report = { event: 'pause_failed', reasons, usage, checkedAt };
  }
}

/** @param {unknown} value @param {string} label */
function number(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw new Error(`Invalid ${label}`);
  return value;
}

/** @param {unknown} value */
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid API object');
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value */
function array(value) {
  if (!Array.isArray(value)) throw new Error('Invalid API collection');
  return /** @type {unknown[]} */ (value);
}

/** @param {unknown} value @param {string} label */
function string(value, label) {
  if (typeof value !== 'string' || !value) throw new Error(`Invalid ${label}`);
  return value;
}

/** @param {unknown[]} rows */
export function countOperations(rows) {
  let classA = 0,
    classB = 0;
  for (const row of rows) {
    const item = object(row);
    const action = string(object(item.dimensions).actionType, 'action type');
    const requests = number(object(item.sum).requests, 'operation count');
    if (FREE_ACTIONS.has(action)) continue;
    if (CLASS_B_ACTIONS.has(action)) classB += requests;
    // Unknown operation types count conservatively toward the smaller allowance.
    else classA += requests;
  }
  return { classA, classB };
}

/**
 * Control-plane calls are necessary here: R2 bindings cannot read account-wide
 * billing or disable a public custom domain. The token stays in a Worker Secret.
 * @param {GuardEnv} env
 * @param {{fetcher?: typeof fetch, now?: Date, checkStorage?: boolean, log?: (record: object) => void, wait?: (ms: number) => Promise<void>, monitorState?: import('./health.mjs').MonitorState, persistState?: (state: import('./health.mjs').MonitorState) => Promise<void>}} [options]
 */
export async function runGuard(env, options = {}) {
  const now = options.now ?? new Date();
  const log = options.log ?? ((record) => console.log(JSON.stringify(record)));
  const monitorState = options.monitorState ?? {};
  const previousProbe = monitorState.pausedCheck;
  let paused = false;
  const request = createRequest(env.CF_API_TOKEN, {
    fetcher: options.fetcher,
    wait: options.wait,
    log,
  });
  /** @type {Partial<{classA: number, classB: number, storageBytes: number}>} */
  const observed = {};
  /** @type {Awaited<ReturnType<typeof resolveBilling>>|undefined} */
  let billing;
  const prefix = `/accounts/${encodeURIComponent(env.CF_ACCOUNT_ID)}`;
  const endpoints = publicEndpoints(env.CF_ACCOUNT_ID, env.TARGETS);
  if (!['observe', 'enforce'].includes(env.MODE)) throw new Error('Invalid guard mode');
  const limits = {
    classA: number(env.CLASS_A_LIMIT, 'Class A limit'),
    classB: number(env.CLASS_B_LIMIT, 'Class B limit'),
    storageBytes: number(env.STORAGE_BYTES_LIMIT, 'storage limit'),
  };
  if (Object.values(limits).some((value) => value === 0))
    throw new Error('Limits must be positive');

  /** @param {string[]} reasons @param {object} usage */
  async function pause(reasons, usage) {
    if (paused) {
      recordPausedCheck(monitorState, +now, 0);
      const result = { event: 'paused_check_failed', reasons, usage, checkedAt: now.toISOString() };
      log(result);
      return result;
    }
    if (env.MODE === 'observe') {
      const result = {
        event: 'would_pause',
        mode: env.MODE,
        reasons,
        usage,
        checkedAt: now.toISOString(),
      };
      log(result);
      return result;
    }
    // A failed write or readback must not cancel the decision to close access.
    // Persist before I/O so an interrupted alarm retries the same decision.
    monitorState.pendingPause ??= { requestedAt: now.toISOString(), reasons, usage };
    await options.persistState?.(monitorState);
    // Disabling domains is persistent. This Worker deliberately never enables one.
    // Close every configured bucket, including a stray development URL.
    const access = await disablePublicAccess(request, endpoints);
    if (!access.disabled) {
      log({
        event: 'pause_failed',
        reasons,
        changeFailures: access.changeFailures,
      });
      throw new PauseFailedError(reasons, usage, now.toISOString());
    }
    const result = { event: 'paused', reasons, usage, checkedAt: now.toISOString() };
    delete monitorState.pendingPause;
    delete monitorState.failureSince;
    delete monitorState.retryNotBefore;
    delete monitorState.lastFailure;
    recordPausedCheck(monitorState, +now, 0);
    log(result);
    return result;
  }

  try {
    // Complete an earlier protective pause even if analytics have recovered.
    // It must take priority over usage checks, grace and their API cooldowns.
    if (monitorState.pendingPause)
      return pause(monitorState.pendingPause.reasons, monitorState.pendingPause.usage);
    if (monitorState.lastFailure && +now < (monitorState.retryNotBefore ?? 0))
      throw new ApiRequestError(monitorState.lastFailure);
    const access = await publicAccessState(request, endpoints);
    if (access.managedEnabled) return pause(['public_entry_reopened'], {});
    if (access.allPaused) {
      paused = true;
      delete monitorState.failureSince;
      delete monitorState.retryNotBefore;
      delete monitorState.lastFailure;
      if (
        previousProbe &&
        previousProbe.checkedAt <= +now &&
        +now < pausedCheckDueAt(previousProbe) &&
        (previousProbe.successes === 0 ||
          (monitorState.billing && +now < Date.parse(monitorState.billing.period.end)))
      ) {
        const result = { event: 'remains_paused', checkedAt: now.toISOString() };
        log(result);
        return result;
      }
      recordPausedCheck(monitorState, +now, 0);
    } else {
      delete monitorState.pausedCheck;
      delete monitorState.pausedSince;
    }
    billing = await resolveBilling(request, prefix, now, monitorState, {
      forceRefresh: paused || !!previousProbe,
      allowFallback: !paused,
    });
    const period = billing.period;
    if (billing.source === 'fallback')
      log({ event: 'billing_cache_fallback', billing, checkedAt: now.toISOString() });
    const response = await request('/graphql', 'POST', {
      query: `query GuardUsage($account: string!, $start: Time!, $end: Time!) {
        viewer { accounts(filter: {accountTag: $account}) {
          r2OperationsAdaptiveGroups(limit: 1000, filter: {datetime_geq: $start, datetime_leq: $end}) {
            dimensions { actionType } sum { requests }
          }
        }}
      }`,
      variables: { account: env.CF_ACCOUNT_ID, start: period.start, end: now.toISOString() },
    });
    const accounts = array(object(object(response.data).viewer).accounts);
    if (accounts.length !== 1) throw new Error('Missing account analytics');
    const rows = array(object(accounts[0]).r2OperationsAdaptiveGroups);
    if (rows.length >= 1000) throw new Error('Truncated operation analytics');
    const operations = countOperations(rows);
    Object.assign(observed, operations);
    const reasons = [];
    if (operations.classA >= limits.classA) reasons.push('class_a_95_percent');
    if (operations.classB >= limits.classB) reasons.push('class_b_95_percent');
    const usage = {
      ...operations,
      billingPeriod: period,
      billing,
      storageBytes: /** @type {number|null} */ (null),
    };
    if (reasons.length) return pause(reasons, usage);

    if (paused || !!previousProbe || (options.checkStorage ?? now.getUTCMinutes() === 0)) {
      // A conservative current-size guard complements delayed daily storage analytics.
      // This account uses default-jurisdiction buckets. Refuse unknown jurisdictions.
      let bytes = 0,
        pages = 0;
      const listing = await request(`${prefix}/r2/buckets?per_page=${PAGE_SIZE}`);
      const buckets = array(object(listing.result).buckets);
      if (
        buckets.length >= PAGE_SIZE ||
        (listing.result_info && object(listing.result_info).cursor)
      )
        throw new Error('Bucket inventory exceeds guard limit');
      for (const rawBucket of buckets) {
        const bucket = object(rawBucket);
        if (bucket.jurisdiction && bucket.jurisdiction !== 'default')
          throw new Error('Unsupported bucket jurisdiction');
        const name = string(bucket.name, 'bucket name');
        let cursor = '';
        const seen = new Set();
        do {
          if (++pages > MAX_PAGES) throw new Error('Object inventory exceeds guard limit');
          const params = new URLSearchParams({ per_page: String(PAGE_SIZE) });
          if (cursor) params.set('cursor', cursor);
          const objects = await request(
            `${prefix}/r2/buckets/${encodeURIComponent(name)}/objects?${params}`,
          );
          const entries = array(objects.result);
          for (const entry of entries) bytes += number(object(entry).size, 'object size');
          observed.storageBytes = bytes;
          if (bytes >= limits.storageBytes)
            return pause(['storage_95_percent'], { ...usage, storageBytes: bytes });
          const info = objects.result_info ? object(objects.result_info) : {};
          cursor =
            info.is_truncated !== false && typeof info.cursor === 'string' ? info.cursor : '';
          if (
            (info.is_truncated === true ||
              (info.is_truncated !== false && entries.length >= PAGE_SIZE)) &&
            !cursor
          )
            throw new Error('Missing inventory continuation cursor');
          if (cursor && seen.has(cursor)) throw new Error('Repeated inventory cursor');
          seen.add(cursor);
        } while (cursor);
      }
      usage.storageBytes = bytes;
    }
    const previous = monitorState.lastHealthy;
    const storageBytes = usage.storageBytes ?? previous?.storageBytes;
    if (storageBytes !== undefined) {
      monitorState.lastHealthy = {
        ...operations,
        billingPeriod: period,
        checkedAt: +now,
        storageBytes,
        storageCheckedAt: usage.storageBytes !== null ? +now : (previous?.storageCheckedAt ?? 0),
      };
    }
    delete monitorState.failureSince;
    delete monitorState.retryNotBefore;
    delete monitorState.lastFailure;
    if (paused) {
      if (
        operations.classA >= limits.classA * 0.8 ||
        operations.classB >= limits.classB * 0.8 ||
        usage.storageBytes === null ||
        usage.storageBytes >= limits.storageBytes * 0.8
      )
        return pause(['insufficient_recovery_headroom'], usage);
      const periodKey = JSON.stringify([billing.subscriptionId, period.start, period.end]);
      const consecutive =
        previousProbe?.periodKey === periodKey &&
        previousProbe.checkedAt < +now &&
        +now <= pausedCheckDueAt(previousProbe) + PAUSED_CHECK_INTERVAL;
      const successes = Math.min(3, (consecutive ? previousProbe.successes : 0) + 1);
      recordPausedCheck(monitorState, +now, successes, periodKey);
      const result = {
        event: successes >= 3 ? 'recovery_ready' : 'paused_check_passed',
        mode: env.MODE,
        usage,
        recoveryChecks: successes,
        checkedAt: now.toISOString(),
      };
      log(result);
      return result;
    }
    const result = {
      event: billing.source === 'fallback' ? 'billing_degraded' : 'within_limits',
      mode: env.MODE,
      usage,
      checkedAt: now.toISOString(),
    };
    log(result);
    return result;
  } catch (error) {
    if (error instanceof PauseFailedError) throw error;
    const usage = {
      error: error instanceof Error ? error.message : 'Unknown error',
      ...(error instanceof ApiRequestError ? { request: error.details } : {}),
      ...(error instanceof BillingUnavailableError ? { billingFailure: error.diagnostics } : {}),
      ...(billing ? { billing } : {}),
      lastHealthy: monitorState.lastHealthy ?? null,
      observed,
    };
    if (paused) return pause(['monitor_error'], usage);
    if (error instanceof ApiRequestError && error.details.retryable) {
      monitorState.failureSince ??= +now;
      monitorState.lastFailure = error.details;
      // Do not move a server-provided cooldown forward on each skipped alarm.
      if ((monitorState.retryNotBefore ?? 0) <= +now)
        monitorState.retryNotBefore = +now + error.details.retryAfterMs;
      const deadline = graceDeadline(monitorState, limits, +now);
      const hasHeadroom = Object.entries(observed).every(
        ([key, value]) => value < limits[/** @type {keyof typeof limits} */ (key)] * 0.8,
      );
      if (+now < deadline && hasHeadroom) {
        const result = {
          event: 'monitor_degraded',
          mode: env.MODE,
          usage,
          checkedAt: now.toISOString(),
          graceUntil: new Date(deadline).toISOString(),
        };
        log(result);
        return result;
      }
    }
    // Permanent errors, insufficient evidence and expired grace still fail closed.
    return pause(['monitor_error'], usage);
  }
}
