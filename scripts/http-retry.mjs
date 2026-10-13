import { setTimeout as delay } from 'node:timers/promises';

const MAX_RETRY_WAIT_MS = 30000;

/**
 * Wait after a retryable HTTP failure, once its response body has been released.
 * Retry-After is a minimum: stop when it exceeds our budget instead of retrying early.
 */
export async function waitForHttpRetry({ label, attempt, attempts, failure, retryAfter }) {
  if (attempt >= attempts)
    throw new Error(`${label}: failed after ${attempts} attempts`, { cause: failure });

  let minimum = 0;
  const value = retryAfter?.trim();
  if (value) {
    const milliseconds = /^\d+$/.test(value)
      ? Number(value) * 1000
      : Date.parse(value) - Date.now();
    // Invalid or expired dates fall back to backoff. Overflowing seconds exceed the budget.
    if (!Number.isNaN(milliseconds)) minimum = Math.max(0, milliseconds);
  }
  if (minimum > MAX_RETRY_WAIT_MS)
    throw new Error(`${label}: Retry-After exceeds the ${MAX_RETRY_WAIT_MS} ms retry wait limit`, {
      cause: failure,
    });

  // Full jitter above the server's minimum spreads retries without exceeding the wait limit.
  const jitterLimit = Math.min(1000 * 2 ** (attempt - 1), MAX_RETRY_WAIT_MS - minimum);
  const wait = minimum + Math.floor(Math.random() * (jitterLimit + 1));
  console.warn(`${label}: ${failure.message}; retrying in ${wait} ms (${attempt + 1}/${attempts})`);
  await delay(wait);
}
