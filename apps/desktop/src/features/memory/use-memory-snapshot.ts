import { useEffect, useState } from 'react';
import type { MemorySnapshot } from '../../client/agent/bridge';
import { showErrorToast } from '../../components/toast-store';

/**
 * Saved memories as the agent bridge reports them, kept current by its `memory` change events, so
 * every page that shows memory (the Memory section, Personal's Memory tab) reads one source. Null
 * until the first read answers, or while `enabled` is false; a failed read shows its error toast.
 * `setSnapshot` takes the snapshot a write answers, before its change event arrives.
 */
export function useMemorySnapshot(enabled = true) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  useEffect(() => {
    const agent = window.desktop?.agent;
    if (!enabled || !agent) return;
    let active = true;
    const off = agent.onChange((event) => {
      if (event.type === 'memory') setSnapshot(event.snapshot);
    });
    agent.memory().then(
      (value) => {
        if (active) setSnapshot(value);
      },
      (error: unknown) => {
        if (active) showErrorToast(error);
      },
    );
    return () => {
      active = false;
      off();
    };
  }, [enabled]);
  return { snapshot: enabled ? snapshot : null, setSnapshot };
}
