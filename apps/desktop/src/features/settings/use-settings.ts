import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import { showErrorToast } from '../../components/toast-store';

export function useSettingsSnapshot() {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings;
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [loading, setLoading] = useState(Boolean(bridge));

  useEffect(() => {
    if (!bridge) return;
    let active = true;
    let receivedChange = false;
    const unsubscribe = bridge.onChange((next) => {
      receivedChange = true;
      if (!active) return;
      setSnapshot(next);
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
        showErrorToast(reason instanceof Error ? reason : t('window.loadError'));
        setLoading(false);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [bridge, t]);

  return { snapshot, loading };
}
