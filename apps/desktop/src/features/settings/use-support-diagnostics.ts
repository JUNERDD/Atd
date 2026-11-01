import { useEffect, useState } from 'react';

type Status =
  | 'idle'
  | 'starting'
  | 'startFailed'
  | 'stopping'
  | 'stopFailed'
  | 'cleared'
  | 'exporting'
  | 'saved'
  | 'cancelled'
  | 'failed';

export function useSupportDiagnostics() {
  const bridge = window.desktop?.diagnostics;
  const [enabled, setEnabled] = useState(false);
  const [focus, setFocus] = useState(false);
  const [recording, setRecording] = useState(false);
  const [cleanupFailed, setCleanupFailed] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [permissionFailed, setPermissionFailed] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const busy = status === 'starting' || status === 'stopping' || status === 'exporting';
  useEffect(() => {
    if (!bridge) return;
    let current = true;
    let revision = 0;
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      const requestedAt = revision;
      const requestId = ++request;
      void bridge.state().then(
        (state) => {
          if (!current || requestId !== request || requestedAt !== revision) return;
          setEnabled(state.enabled);
          setFocus(state.focusEnabled);
          setReady(!state.focusEnabled || (state.accessibilityTrusted && state.mouseTapActive));
          setRecording(state.recording);
          setCleanupFailed(state.cleanupFailed);
          setExpiresAt(state.expiresAt);
          if (state.enabled && state.recording) timer = setTimeout(refresh, 2000);
        },
        () => {
          if (current && requestId === request && requestedAt === revision) setEnabled(false);
        },
      );
    };
    const unsubscribe = bridge.onRecording((next) => {
      revision++;
      setRecording(next);
      clearTimeout(timer);
      if (!next) {
        setPermissionFailed(false);
        setExpiresAt(null);
      }
      refresh();
    });
    refresh();
    return () => {
      current = false;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [bridge]);
  async function preparePermissions() {
    if (!bridge || !recording || preparing || busy) return;
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
  async function startRecording() {
    if (!bridge || recording || busy) return;
    setStatus('starting');
    setPermissionFailed(false);
    try {
      await bridge.start();
      setStatus('idle');
    } catch {
      setStatus('startFailed');
    }
  }
  async function stopRecording() {
    if (!bridge || busy) return;
    setStatus('stopping');
    try {
      const result = await bridge.stop();
      setCleanupFailed(result.cleanupFailed);
      setStatus(result.cleanupFailed ? 'idle' : 'cleared');
    } catch {
      setStatus('stopFailed');
    }
  }
  async function exportReport() {
    if (!bridge || !recording || busy) return;
    setStatus('exporting');
    try {
      const result = await bridge.export();
      if (result.saved) setCleanupFailed(result.cleanupFailed);
      setStatus(result.saved ? 'saved' : 'cancelled');
    } catch {
      setStatus('failed');
    }
  }
  return {
    enabled,
    focus,
    recording,
    cleanupFailed,
    expiresAt,
    busy,
    ready,
    preparing,
    permissionFailed,
    preparePermissions,
    startRecording,
    stopRecording,
    status,
    exportReport,
  };
}
