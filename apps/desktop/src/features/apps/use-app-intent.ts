import { useState } from 'react';
import type { Capability } from '@atd/agent-contracts';

/** A control on an app's page that starts a write. */
export type AppIntent =
  | 'open'
  | 'edit'
  | 'clear'
  | 'delete'
  | `revert:${number}`
  | `grant:${Capability}`;

/**
 * Which control of an app's page started the write in flight (`pending`), so that control shows
 * the busy state in place while the page's other controls only ignore input. `busy` is whether
 * any write on the app runs (`AppActions.busy`). `start` records the control and runs its action
 * unless a write is already running; a confirmation the user cancels starts no write, so its
 * control never shows busy.
 */
export function useAppIntent(busy: boolean) {
  const [intent, setIntent] = useState<AppIntent | null>(null);
  return {
    pending: busy ? intent : null,
    start: (next: AppIntent, run: () => void) => {
      if (busy) return;
      setIntent(next);
      run();
    },
  };
}
