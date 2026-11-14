import { setTimeout as delay } from 'node:timers/promises';

const MAX_RETRY_WAIT_MS = 30000;
const TIMEOUT_CODES = new Set([
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);
const CONNECTION_RESET_CODES = new Set(['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET']);

function findErrorCode(error) {
  const seen = new Set();
  for (
    let current = error;
    current && typeof current === 'object' && !seen.has(current);
    current = current.cause
  ) {
    seen.add(current);
    if (typeof current.code === 'string') return current.code;
  }
  return undefined;
}

/**
 * Classifies transient fetch failures (abort/transport timeouts and dropped sockets) for
 * idempotent GET/HEAD verification reads. Returns null for permanent or assertion errors.
 */
export function retryableTransportFailure(error, signal, timeout) {
  if (signal.aborted && ['TimeoutError', 'AbortError'].includes(error?.name)) {
    return new Error(`Timed out after ${timeout} ms`, { cause: error });
  }
  const code = findErrorCode(error);
  if (TIMEOUT_CODES.has(code)) {
    return new Error(`Transport timeout (${code})`, { cause: error });
  }
  if (CONNECTION_RESET_CODES.has(code)) {
    return new Error(`Connection reset (${code})`, { cause: error });
  }
  return null;
}

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
