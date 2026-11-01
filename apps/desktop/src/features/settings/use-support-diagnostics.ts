import { useEffect, useState } from 'react';

export function useSupportDiagnostics() {
  const bridge = window.desktop?.diagnostics;
  const [enabled, setEnabled] = useState(false);
  const [focus, setFocus] = useState(false);
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [permissionFailed, setPermissionFailed] = useState(false);
  const [status, setStatus] = useState<'idle' | 'exporting' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      void bridge?.state().then(
        (state) => {
          if (!current) return;
          setEnabled(state.enabled);
          setFocus(state.focusEnabled);
          setReady(!state.focusEnabled || (state.accessibilityTrusted && state.mouseTapActive));
          if (state.enabled) timer = setTimeout(refresh, 2000);
        },
        () => {
          if (current) setEnabled(false);
        },
      );
    refresh();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [bridge]);
  async function preparePermissions() {
    if (!bridge || preparing) return;
    setPreparing(true);
    setPermissionFailed(false);
    try {
      await bridge.prepare();
    } catch {
      setPermissionFailed(true);
    } finally {
      setPreparing(false);
    }
  }
  async function exportReport() {
    if (!bridge || status === 'exporting') return;
    setStatus('exporting');
    try {
      const result = await bridge.export();
      setStatus(result.saved ? 'saved' : 'idle');
    } catch {
      setStatus('failed');
    }
  }
  return {
    enabled,
    focus,
    ready,
    preparing,
    permissionFailed,
    preparePermissions,
    status,
    exportReport,
  };
}
