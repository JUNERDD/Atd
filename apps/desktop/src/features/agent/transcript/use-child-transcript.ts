import { useEffect, useState } from 'react';
import type { ChildTranscriptDetail } from '../../../../electron/agent/bridge';
import { applyTranscriptPatch } from '../../../../electron/agent/transcript-schema';
import { messageOf } from '../../../lib/errors';

/**
 * One child session's transcript while the drill-in view shows it. `childTranscript` both
 * subscribes and returns the current state; patches then arrive as `childTranscript` events on
 * the shared change stream and apply like the parent's. A revision gap resubscribes for a fresh
 * state. Main adds a hold per call, even one that fails, and handles calls in send order, so each
 * call is paired with one release when the key changes or the view unmounts.
 */
export function useChildTranscript(
  taskId: string,
  childKey: string,
): { detail: ChildTranscriptDetail | null; error: string } {
  const [state, setState] = useState<{
    key: string;
    detail: ChildTranscriptDetail | null;
    error: string;
  }>({ key: '', detail: null, error: '' });
  const stateKey = `${taskId}\n${childKey}`;

  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    let active = true;
    let seq = 0;
    let held = 0;
    let current: ChildTranscriptDetail | null = null;
    let waitingForSeed = false;
    const release = () => void bridge.releaseChildTranscript(taskId, childKey).catch(() => {});

    const publish = (next: ChildTranscriptDetail) => {
      current = next;
      waitingForSeed = false;
      setState({ key: stateKey, detail: next, error: '' });
    };

    const seed = () => {
      const request = ++seq;
      waitingForSeed = true;
      held += 1;
      bridge.childTranscript(taskId, childKey).then(
        (value) => {
          if (active && request === seq) publish(value);
        },
        (error: unknown) => {
          if (!active || request !== seq) return;
          waitingForSeed = false;
          setState({ key: stateKey, detail: current, error: messageOf(error) });
        },
      );
    };

    const unsubscribe = bridge.onChange((event) => {
      if (event.type !== 'childTranscript') return;
      const { patch } = event;
      if (patch.taskId !== taskId || patch.childKey !== childKey) return;
      // A seed in flight returns a state at least as new as this patch; a patch landing between
      // that state and the next one surfaces as a revision gap and resubscribes once.
      if (waitingForSeed) return;
      const patched = current
        ? applyTranscriptPatch({ revision: current.revision, blocks: current.blocks }, patch)
        : null;
      if (!current || !patched) {
        seed();
        return;
      }
      publish({ ...current, revision: patched.revision, blocks: patched.blocks });
    });
    seed();
    return () => {
      active = false;
      unsubscribe();
      for (; held > 0; held -= 1) release();
    };
  }, [taskId, childKey, stateKey]);

  return state.key === stateKey
    ? { detail: state.detail, error: state.error }
    : { detail: null, error: '' };
}
