// @ts-check

const API = 'https://api.cloudflare.com/client/v4';
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT = 5000;

/** @typedef {{method: string, path: string, status: number|null, ray: string|null, attempt: number, elapsedMs: number, kind: string, retryable: boolean, retryAfterMs: number, fields?: Record<string, string>}} RequestFailure */

/** A validated response may need another read, sharing the transport retry budget. */
export class ResponseValidationError extends Error {
  /** @param {string} kind @param {{retryable?: boolean, retryPath?: string, fields?: Record<string, string>}} [options] */
  constructor(kind, options = {}) {
    super(kind);
    this.kind = kind;
    this.retryable = options.retryable ?? false;
    this.retryPath = options.retryPath;
    this.fields = options.fields;
  }
}

export class ApiRequestError extends Error {
  /** @param {RequestFailure} details */
  constructor(details) {
    super(
      `${details.method} ${details.path}: ${details.kind} (HTTP ${details.status ?? 'unavailable'}, attempt ${details.attempt})`,
    );
    this.name = 'ApiRequestError';
    this.details = details;
  }
}

/** @param {Response} response */
async function readPayload(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty API response');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('API response exceeds guard limit');
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const payload = JSON.parse(new TextDecoder().decode(data));
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('Invalid API response');
  return /** @type {Record<string, unknown>} */ (payload);
}

/**
 * Only used for reads, GraphQL queries and idempotent public-access settings.
 * Diagnostics exclude credentials, query strings and response bodies.
 * @param {string} token
 * @param {{fetcher?: typeof fetch, wait?: (ms: number) => Promise<void>, log?: (record: object) => void}} [options]
 */
export function createRequest(token, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const wait = options.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((record) => console.log(JSON.stringify(record)));
  // Bound extra calls across the entire check, including paginated inventories.
  let retriesRemaining = MAX_ATTEMPTS - 1;
  /** @param {string} path @param {'GET'|'POST'|'PUT'} [method] @param {unknown} [body]
   * @param {{validate?: (payload: Record<string, unknown>, path: string) => void}} [settings] */
  return async function request(path, method = 'GET', body, settings = {}) {
    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      /** @type {Response|undefined} */
      let response;
      let retryAfterMs = 0;
      let retryable = false;
      let kind = 'invalid_response';
      try {
        response = await fetcher(API + path, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          kind = 'http_error';
          retryable = response.status === 429 || response.status >= 500;
          const retryAfter = response.headers.get('retry-after');
          if (retryAfter) {
            const delay = /^\d+(\.\d+)?$/.test(retryAfter)
              ? Number(retryAfter) * 1000
              : Date.parse(retryAfter) - Date.now();
            if (Number.isFinite(delay)) retryAfterMs = Math.max(0, delay);
          }
          throw new Error('Unsuccessful API response');
        }
        const payload = await readPayload(response);
        if (payload.success === false || (Array.isArray(payload.errors) && payload.errors.length)) {
          kind = 'api_error';
          // GraphQL may report a temporary service error with HTTP 200.
          retryable =
            Array.isArray(payload.errors) &&
            payload.errors.length > 0 &&
            payload.errors.every((error) =>
              /timeout|timed out|rate limit|too many requests|internal server error|service unavailable/i.test(
                typeof error?.message === 'string' ? error.message : '',
              ),
            );
          throw new Error('API reported an error');
        }
        settings.validate?.(payload, path);
        if (attempt > 1)
          log({ event: 'api_request_recovered', method, path: path.split('?')[0], attempt });
        return payload;
      } catch (error) {
        if (error instanceof ResponseValidationError) {
          kind = error.kind;
          retryable = error.retryable;
        } else if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
          kind = 'timeout';
          retryable = true;
        } else if (error instanceof TypeError) {
          kind = 'network_error';
          retryable = true;
        }
        await response?.body?.cancel().catch(() => {});
        const details = {
          method,
          path: path.split('?')[0],
          status: response?.status ?? null,
          ray: response?.headers.get('cf-ray') ?? null,
          attempt,
          elapsedMs: Date.now() - started,
          kind,
          retryable,
          retryAfterMs,
          ...(error instanceof ResponseValidationError && error.fields
            ? { fields: error.fields }
            : {}),
        };
        // Long server cooldowns are handled by the next persistent alarm, rather
        // than keeping one invocation alive or retrying before Retry-After.
        if (
          !retryable ||
          attempt === MAX_ATTEMPTS ||
          retriesRemaining === 0 ||
          retryAfterMs > MAX_RETRY_WAIT
        ) {
          log({ event: 'api_request_failed', ...details });
          throw new ApiRequestError(details);
        }
        const delayMs = Math.max(
          retryAfterMs,
          1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250),
        );
        retriesRemaining--;
        log({ event: 'api_request_retry', ...details, delayMs });
        await wait(delayMs);
        if (error instanceof ResponseValidationError && error.retryPath) path = error.retryPath;
      }
    }
  };
}
