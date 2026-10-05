import type { RetrySettings } from '@earendil-works/pi-coding-agent';

/**
 * How every run's Pi sessions, parent and subagent children alike, treat a failed model request.
 * Pi retries a turn that ended in a transient provider error (rate limit, overload, 5xx, dropped
 * connection, timeout) after a 2 s then 4 s backoff, and leaves context overflow to compaction;
 * the last failure stays the run's outcome. `httpIdleTimeoutMs` bounds the wait for a response's
 * headers, not the stream after them, so long thinking is unaffected while a provider that never
 * answers fails, and is retried, after 2 minutes instead of Pi's 5.
 */
export const REQUEST_POLICY: { retry: RetrySettings; httpIdleTimeoutMs: number } = {
  retry: { enabled: true, maxRetries: 2 },
  httpIdleTimeoutMs: 120_000,
};
