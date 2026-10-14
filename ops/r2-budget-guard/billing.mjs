// @ts-check
import { ApiRequestError, ResponseValidationError } from './api.mjs';

export const BILLING_REFRESH_INTERVAL = 15 * 60000;
export const BILLING_CACHE_MAX_AGE = 2 * 60 * 60000;
export const BILLING_ROLLOVER_MAX_AGE = 2 * 60 * 60000;
const BILLING_FAILURE_REFRESH_INTERVAL = 5 * 60000;
const BILLING_ROLLOVER_VERIFICATION_MAX_AGE = 30 * 60000;
const DAY = 86400000;

/** @typedef {{start: string, end: string}} BillingPeriod */
/** @typedef {{accountPath: string, subscriptionId: string, period: BillingPeriod, verifiedAt: number}} BillingCache */
/** @typedef {{billing?: BillingCache, billingFailure?: import('./api.mjs').RequestFailure, billingRetryNotBefore?: number, billingRefreshNotBefore?: number}} BillingState */

export class BillingUnavailableError extends Error {
  /** @param {import('./api.mjs').RequestFailure} request @param {BillingCache|undefined} cache @param {number} now */
  constructor(request, cache, now) {
    super(`Billing metadata unavailable: ${request.kind}; no usable verified billing period`);
    this.diagnostics = {
      request,
      cacheAgeMs: cache ? now - cache.verifiedAt : null,
      cachedPeriod: cache?.period ?? null,
    };
  }
}

/** @param {unknown} value */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ResponseValidationError('billing_invalid_response');
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown[]} subscriptions */
function selectSubscription(subscriptions) {
  const matches = subscriptions.map(record).filter((s) => record(s.rate_plan).id === 'r2_paid');
  if (matches.length !== 1) throw new ResponseValidationError('billing_subscription_ambiguous');
  return matches[0];
}

/** Missing or stale metadata can be reread; malformed or contradictory dates fail closed.
 * @param {Record<string, unknown>} subscription @param {Date} now
 * @param {BillingCache} [cache] @param {string} [retryPath] */
function parsePeriod(subscription, now, cache, retryPath) {
  const fields = {
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
  };
  /** @type {Record<string, string>} */
  const missing = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') {
      missing[key] = value === undefined ? 'absent' : value === null ? 'null' : 'empty';
      continue;
    }
    const time = typeof value === 'string' ? Date.parse(value) : NaN;
    if (!Number.isFinite(time))
      throw new ResponseValidationError('billing_invalid_date', {
        fields: { [key]: typeof value },
      });
    if (key === 'current_period_start' && time > +now)
      throw new ResponseValidationError('billing_period_outside_current_time');
    if (cache && +now < Date.parse(cache.period.end)) {
      const expected = key === 'current_period_start' ? cache.period.start : cache.period.end;
      if (time !== Date.parse(expected))
        throw new ResponseValidationError('billing_period_conflict');
    }
    if (cache && +now >= Date.parse(cache.period.end)) {
      const boundary = Date.parse(cache.period.end);
      // Partial renewal fields may equal the old cycle or belong to a later
      // cycle. Contradictory earlier dates never qualify for a bridge.
      if (
        (key === 'current_period_start' &&
          time !== Date.parse(cache.period.start) &&
          time < boundary) ||
        (key === 'current_period_end' && time < boundary)
      )
        throw new ResponseValidationError('billing_period_conflict');
    }
  }
  if (Object.keys(missing).length)
    throw new ResponseValidationError('billing_fields_missing', {
      retryable: true,
      retryPath,
      fields: missing,
    });
  const start = new Date(/** @type {string} */ (fields.current_period_start));
  const end = new Date(/** @type {string} */ (fields.current_period_end));
  if (+end <= +start) throw new ResponseValidationError('billing_period_outside_current_time');
  if (+end <= +now)
    throw new ResponseValidationError('billing_period_stale', {
      retryable: true,
      retryPath,
      fields: { current_period_start: start.toISOString(), current_period_end: end.toISOString() },
    });
  if (cache && +now >= Date.parse(cache.period.end) && +start < Date.parse(cache.period.end))
    throw new ResponseValidationError('billing_period_conflict');
  if (+now - +start > 31 * DAY)
    throw new ResponseValidationError('billing_period_exceeds_retention');
  return { start: start.toISOString(), end: end.toISOString() };
}

/** @param {unknown[]} subscriptions @param {Date} now */
export function billingPeriod(subscriptions, now) {
  return parsePeriod(selectSubscription(subscriptions), now);
}

/** @param {BillingCache|undefined} cache @param {string} prefix @param {number} now */
function usableCache(cache, prefix, now) {
  return !!(
    cache &&
    cache.accountPath === prefix &&
    typeof cache.subscriptionId === 'string' &&
    cache.subscriptionId &&
    Number.isFinite(cache.verifiedAt) &&
    cache.verifiedAt <= now &&
    now - cache.verifiedAt < BILLING_CACHE_MAX_AGE &&
    Date.parse(cache.period.start) <= cache.verifiedAt &&
    now < Date.parse(cache.period.end) &&
    now - Date.parse(cache.period.start) <= 31 * 86400000
  );
}

/** Only the exact recently verified ending cycle can bridge a delayed renewal.
 * The query includes old usage as well as all usage after the known boundary;
 * neither a new billing period nor a reset allowance is invented.
 * @param {BillingCache|undefined} cache @param {string} prefix @param {number} now
 * @param {import('./api.mjs').RequestFailure} failure */
function usableRollover(cache, prefix, now, failure) {
  if (!cache || cache.accountPath !== prefix || !cache.subscriptionId) return false;
  const start = Date.parse(cache.period.start);
  const end = Date.parse(cache.period.end);
  return (
    failure.retryable &&
    (failure.kind !== 'billing_period_stale' ||
      (failure.fields?.current_period_start === cache.period.start &&
        failure.fields?.current_period_end === cache.period.end)) &&
    Number.isFinite(cache.verifiedAt) &&
    start <= cache.verifiedAt &&
    cache.verifiedAt < end &&
    end - cache.verifiedAt <= BILLING_ROLLOVER_VERIFICATION_MAX_AGE &&
    end - start <= 31 * DAY &&
    end <= now &&
    now < end + BILLING_ROLLOVER_MAX_AGE
  );
}

/**
 * Billing timestamps change independently of usage. Cache only fully verified
 * metadata; using a cache must never advance verifiedAt or its hard deadline.
 * @param {ReturnType<typeof import('./api.mjs').createRequest>} request
 * @param {string} prefix @param {Date} now @param {BillingState} state
 * @param {{forceRefresh?: boolean, allowFallback?: boolean}} [options]
 */
export async function resolveBilling(request, prefix, now, state, options = {}) {
  const cache = state.billing;
  const usable = usableCache(cache, prefix, +now);
  /** @param {BillingCache} value @param {'api'|'cache'|'fallback'|'rollover'} source */
  const result = (value, source) => ({
    period: value.period,
    // A 30-day lookback plus the two-hour bridge stays below the API's 31-day
    // query limit, even after a 31-day cycle. All post-boundary usage is included.
    queryStart:
      source === 'rollover'
        ? new Date(
            Math.max(Date.parse(value.period.start), Date.parse(value.period.end) - 30 * DAY),
          ).toISOString()
        : value.period.start,
    source,
    subscriptionId: value.subscriptionId,
    verifiedAt: value.verifiedAt,
    cacheAgeMs: +now - value.verifiedAt,
    expiresAt: new Date(
      source === 'rollover'
        ? Date.parse(value.period.end) + BILLING_ROLLOVER_MAX_AGE
        : Math.min(value.verifiedAt + BILLING_CACHE_MAX_AGE, Date.parse(value.period.end)),
    ).toISOString(),
    ...(['fallback', 'rollover'].includes(source) ? { failure: state.billingFailure } : {}),
  });
  if (
    usable &&
    cache &&
    !options.forceRefresh &&
    !state.billingFailure &&
    +now - cache.verifiedAt < BILLING_REFRESH_INTERVAL
  )
    return result(cache, 'cache');

  /** @type {BillingCache|undefined} */
  let verified;
  let attempted = false;
  let expectedId = cache?.accountPath === prefix ? cache.subscriptionId : undefined;
  const listPath = `${prefix}/subscriptions`;
  try {
    if (state.billingFailure && +now < (state.billingRetryNotBefore ?? 0))
      throw new ApiRequestError(state.billingFailure);
    if (
      state.billingFailure &&
      !options.forceRefresh &&
      +now < (state.billingRefreshNotBefore ?? 0)
    )
      throw new ApiRequestError(state.billingFailure);
    attempted = true;
    await request(listPath, 'GET', undefined, {
      validate(payload, path) {
        if (path === listPath && !Array.isArray(payload.result))
          throw new ResponseValidationError('billing_invalid_response');
        const subscription =
          path === listPath
            ? selectSubscription(/** @type {unknown[]} */ (payload.result))
            : record(payload.result);
        const id = subscription.id;
        if (typeof id !== 'string' || !id || record(subscription.rate_plan).id !== 'r2_paid')
          throw new ResponseValidationError('billing_subscription_identity_missing');
        if (expectedId && id !== expectedId)
          throw new ResponseValidationError('billing_subscription_conflict');
        expectedId = id;
        if (
          ['Cancelled', 'Failed', 'Expired', 'AwaitingPayment'].includes(String(subscription.state))
        )
          throw new ResponseValidationError('billing_subscription_inactive');
        const period = parsePeriod(
          subscription,
          now,
          cache?.accountPath === prefix ? cache : undefined,
          path === listPath ? `${listPath}/${encodeURIComponent(id)}` : undefined,
        );
        verified = { accountPath: prefix, subscriptionId: id, period, verifiedAt: +now };
      },
    });
  } catch (error) {
    if (!(error instanceof ApiRequestError) || !error.details.retryable) {
      delete state.billing;
      delete state.billingFailure;
      delete state.billingRetryNotBefore;
      delete state.billingRefreshNotBefore;
      throw error;
    }
    if (attempted) {
      state.billingFailure = error.details;
      state.billingRetryNotBefore = +now + error.details.retryAfterMs;
      state.billingRefreshNotBefore = +now + BILLING_FAILURE_REFRESH_INTERVAL;
    }
    if (usable && cache && options.allowFallback !== false && !options.forceRefresh)
      return result(cache, 'fallback');
    if (
      cache &&
      options.allowFallback !== false &&
      !options.forceRefresh &&
      usableRollover(cache, prefix, +now, error.details)
    )
      return result(cache, 'rollover');
    // A metadata TTL must not gain another analytics grace period at expiry.
    throw new BillingUnavailableError(error.details, cache, +now);
  }
  if (!verified) throw new Error('Billing validation did not complete');
  state.billing = verified;
  delete state.billingFailure;
  delete state.billingRetryNotBefore;
  delete state.billingRefreshNotBefore;
  return result(verified, 'api');
}
