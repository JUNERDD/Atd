import type { SyntheticEvent } from 'react';

/**
 * Runs the consumer handler first, then the internal handler unless the
 * consumer called `event.preventDefault()`. Cancellation lets a consumer
 * observe or veto internal behavior (such as the Trigger expand toggle)
 * without reimplementing it.
 */
export function composeEventHandlers<E extends SyntheticEvent>(
  consumer: ((event: E) => void) | undefined,
  internal: (event: E) => void,
): (event: E) => void {
  return (event) => {
    consumer?.(event);
    if (!event.defaultPrevented) internal(event);
  };
}
