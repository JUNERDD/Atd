import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { ServiceBlock } from '@atd/agent-contracts';

/** A failed model request Pi is retrying now (request-policy.ts). */
export interface RetryingRequest {
  attempt: number;
  maxAttempts: number;
  error: string;
  startedAt: number;
}

/**
 * Follows one session's automatic retries for the live transcript. A retry starts with
 * `auto_retry_start`, after Pi persisted the failed attempt, and stops showing once the retry gets
 * a response (its assistant `message_start`; an attempt that fails again starts as an error) or
 * when `auto_retry_end` reports the last failure or a cancellation. Nothing of it is persisted:
 * a reload shows the attempts' outcome, never a retry in progress.
 */
export function nextRetrying(
  current: RetryingRequest | null,
  event: AgentSessionEvent,
): RetryingRequest | null {
  if (event.type === 'auto_retry_start')
    return {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      error: event.errorMessage,
      startedAt: Date.now(),
    };
  if (event.type === 'auto_retry_end') return null;
  if (
    event.type === 'message_start' &&
    event.message.role === 'assistant' &&
    event.message.stopReason !== 'error'
  )
    return null;
  return current;
}

/** The live `retry` block; its id changes with each attempt, so a new attempt replaces it. */
export function retryBlock(runId: string, retrying: RetryingRequest): ServiceBlock {
  return {
    kind: 'retry',
    id: `retry:${retrying.startedAt}:${retrying.attempt}`,
    runId,
    timestamp: retrying.startedAt,
    endedAt: retrying.startedAt,
    attempt: retrying.attempt,
    maxAttempts: retrying.maxAttempts,
    error: retrying.error,
  };
}
