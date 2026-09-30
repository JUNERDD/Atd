import { useCallback, useEffect, useState } from 'react';
import type { SettingsSnapshot } from '../../client/settings-contract';

/**
 * The settings snapshot: the initial read, then every broadcast change. `failed` reports a failed
 * initial read until a broadcast or a successful `retry` replaces it; the caller shows it where it
 * applies. A retry does not return to `loading`: pages that work without the snapshot stay as they
 * are, and `retrying` covers the read.
 */
export function useSettingsSnapshot() {
  const bridge = window.desktop?.settings;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = bridge.onChange((next) => {
      receivedChange = true;
      if (!active) return;
      setSnapshot(next);
      setFailed(false);
      setRetrying(false);
      setLoading(false);
    });

    void bridge.get().then(
      (next) => {
        // A broadcast received during the initial read is the more recent snapshot.
        if (!active) return;
        if (!receivedChange) setSnapshot(next);
        setFailed(false);
        setRetrying(false);
        setLoading(false);
      },
      () => {
        if (!active || receivedChange) return;
        setFailed(true);
        setRetrying(false);
        setLoading(false);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, attempt]);

  /** Reads the snapshot again after a failed read; a retry already running ignores the call. */
  const retry = useCallback(() => {
    if (retrying) return;
    setRetrying(true);
    setAttempt((current) => current + 1);
  }, [retrying]);

  return { snapshot, loading, failed, retrying, retry };
}
