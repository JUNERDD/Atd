import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { showErrorToast } from '../../components/toast-store';
import { actOnAnswer } from './command-answer';
import { settleLightRun } from './light-command';
import {
  commandRun,
  followCommandRuns,
  subscribeCommandRuns,
  type CommandRun,
} from './command-results';

/**
 * Acts on remembered command runs as they complete (`followCommandRuns`): copies the answer, or
 * writes it into the app the command ran from. A light run's end is its capsule's to report
 * (`settleLightRun`). Mounted once, by the panel's launch channel.
 */
export function useCommandResults(): void {
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onChange((event) => {
      for (const settled of followCommandRuns(event)) {
        if (settleLightRun(settled) || !settled.answer) continue;
        void actOnAnswer(settled).catch(showErrorToast);
      }
    });
  }, []);
}

/** The remembered command run `runId` (none for `undefined`), following changes to its record. */
export function useCommandRun(runId: string | undefined): CommandRun | undefined {
  const read = useCallback(() => (runId ? commandRun(runId) : undefined), [runId]);
  return useSyncExternalStore(subscribeCommandRuns, read);
}
