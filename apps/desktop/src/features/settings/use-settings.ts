import { useEffect, useState } from 'react';
import type { SettingsSnapshot } from '../../../electron/settings-contract';

export function useSettingsSnapshot() {
  const bridge = window.desktop?.settings;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = bridge.onChange((next) => {
      receivedChange = true;
      if (!active) return;
      setSnapshot(next);
      setError('');
      setLoading(false);
    });

    void bridge.get().then(
      (next) => {
        // A broadcast received during the initial read is the more recent snapshot.
        if (active && !receivedChange) setSnapshot(next);
        if (active) setLoading(false);
      },
      (reason: unknown) => {
        if (!active || receivedChange) return;
        setError(reason instanceof Error ? reason.message : 'Settings could not be loaded.');
        setLoading(false);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge]);

  return { snapshot, loading, error };
}
