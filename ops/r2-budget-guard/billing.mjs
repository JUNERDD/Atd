// @ts-check
import { ApiRequestError, ResponseValidationError } from './api.mjs';

export const BILLING_REFRESH_INTERVAL = 15 * 60000;
export const BILLING_CACHE_MAX_AGE = 30 * 60000;

/** @typedef {{start: string, end: string}} BillingPeriod */
/** @typedef {{accountPath: string, subscriptionId: string, period: BillingPeriod, verifiedAt: number}} BillingCache */
/** @typedef {{billing?: BillingCache, billingFailure?: import('./api.mjs').RequestFailure, billingRetryNotBefore?: number}} BillingState */

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

/** Only absent values are recoverable; malformed or contradictory dates fail closed.
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
    if (key === 'current_period_start' ? time > +now : time <= +now)
      throw new ResponseValidationError('billing_period_outside_current_time');
    if (cache && +now < Date.parse(cache.period.end)) {
      const expected = key === 'current_period_start' ? cache.period.start : cache.period.end;
      if (time !== Date.parse(expected))
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
  if (+now - +start > 31 * 86400000)
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
  /** @param {BillingCache} value @param {'api'|'cache'|'fallback'} source */
  const result = (value, source) => ({
    period: value.period,
    source,
    subscriptionId: value.subscriptionId,
    verifiedAt: value.verifiedAt,
    cacheAgeMs: +now - value.verifiedAt,
    expiresAt: new Date(
      Math.min(value.verifiedAt + BILLING_CACHE_MAX_AGE, Date.parse(value.period.end)),
    ).toISOString(),
    ...(source === 'fallback' ? { failure: state.billingFailure } : {}),
  });
  if (
    usable &&
    cache &&
    !options.forceRefresh &&
    !state.billingFailure &&
    +now - cache.verifiedAt < BILLING_REFRESH_INTERVAL &&
    Date.parse(cache.period.end) - +now > BILLING_REFRESH_INTERVAL
  )
    return result(cache, 'cache');

  /** @type {BillingCache|undefined} */
  let verified;
  let expectedId = cache?.accountPath === prefix ? cache.subscriptionId : undefined;
  const listPath = `${prefix}/subscriptions`;
  try {
    if (state.billingFailure && +now < (state.billingRetryNotBefore ?? 0))
      throw new ApiRequestError(state.billingFailure);
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
          `${listPath}/${encodeURIComponent(id)}`,
        );
        verified = { accountPath: prefix, subscriptionId: id, period, verifiedAt: +now };
      },
    });
  } catch (error) {
    if (!(error instanceof ApiRequestError) || !error.details.retryable) {
      delete state.billing;
      delete state.billingFailure;
      delete state.billingRetryNotBefore;
      throw error;
    }
    state.billingFailure = error.details;
    if ((state.billingRetryNotBefore ?? 0) <= +now)
      state.billingRetryNotBefore = +now + error.details.retryAfterMs;
    if (usable && cache && options.allowFallback !== false) return result(cache, 'fallback');
    // A metadata TTL must not gain another analytics grace period at expiry.
    throw new BillingUnavailableError(error.details, cache, +now);
  }
  if (!verified) throw new Error('Billing validation did not complete');
  state.billing = verified;
  delete state.billingFailure;
  delete state.billingRetryNotBefore;
  return result(verified, 'api');
}
