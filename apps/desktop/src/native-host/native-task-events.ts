import type { TaskQueueWithdrawn } from '../client/contract';
import type { NativeBridge } from '../native-bridge/client';
import { nativeTaskOpen } from './native-automations';

/** Subscribe before host installation awaits: every cancellation result must reach its draft. */
export function nativeTaskEvents(native: NativeBridge) {
  const onTaskOpen = nativeTaskOpen(native);
  const listeners = new Set<(event: TaskQueueWithdrawn) => void>();
  const waiting: TaskQueueWithdrawn[] = [];
  native.on('task.queueWithdrawn', (event) => {
    if (!listeners.size) waiting.push(event);
    else for (const listener of listeners) listener(event);
  });
  return {
    onTaskOpen,
    onTaskQueueWithdrawn(listener: (event: TaskQueueWithdrawn) => void) {
      listeners.add(listener);
      for (const event of waiting.splice(0)) listener(event);
      return () => void listeners.delete(listener);
    },
  };
}
