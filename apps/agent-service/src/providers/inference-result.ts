import type { AssistantMessage } from '@earendil-works/pi-ai';

/** Check a final result after any Pi session recovery, never while its stream is settling. */
export function inferenceError(
  message: Pick<AssistantMessage, 'stopReason' | 'errorMessage'>,
): string | undefined {
  if (message.stopReason === 'length')
    return 'The model response was cut off by its output limit. Try again or split the request.';
  if (message.stopReason === 'error') return message.errorMessage || 'The model request failed.';
  if (message.stopReason === 'aborted')
    return message.errorMessage || 'The model request was cancelled.';
  return undefined;
}
