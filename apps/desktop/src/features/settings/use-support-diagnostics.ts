import { useEffect, useState } from 'react';

type Status =
  | 'idle'
  | 'starting'
  | 'startFailed'
  | 'exporting'
  | 'saved'
  | 'cleanupFailed'
  | 'cancelled'
  | 'failed';

export function useSupportDiagnostics() {
  const bridge = window.desktop?.diagnostics;
  const [enabled, setEnabled] = useState(false);
  const [focus, setFocus] = useState(false);
  const [recording, setRecording] = useState(false);
  const [ready, setReady] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [permissionFailed, setPermissionFailed] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
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
          if (!current || requestId !== request) return;
          setEnabled(state.enabled);
          setFocus(state.focusEnabled);
          setReady(!state.focusEnabled || (state.accessibilityTrusted && state.mouseTapActive));
          if (requestedAt !== revision) return;
          setRecording(state.recording);
          if (state.enabled && state.recording) timer = setTimeout(refresh, 2000);
        },
        () => {
          if (current && requestId === request) setEnabled(false);
        },
      );
    };
    const unsubscribe = bridge.onRecording((next) => {
      revision++;
      setRecording(next);
      clearTimeout(timer);
      if (next) refresh();
      else setPermissionFailed(false);
    });
    refresh();
    return () => {
      current = false;
      unsubscribe();
      clearTimeout(timer);
    };
  }, [bridge]);
  async function preparePermissions() {
    if (!bridge || !recording || preparing) return;
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
    if (!bridge || recording || status === 'starting' || status === 'exporting') return;
    setStatus('starting');
    setPermissionFailed(false);
    try {
      await bridge.start();
      setStatus('idle');
    } catch {
      setStatus('startFailed');
    }
  }
  async function exportReport() {
    if (!bridge || !recording || status === 'exporting' || status === 'starting') return;
    setStatus('exporting');
    try {
      const result = await bridge.export();
      setStatus(result.saved ? (result.cleanupFailed ? 'cleanupFailed' : 'saved') : 'cancelled');
    } catch {
      setStatus('failed');
    }
  }
  return {
    enabled,
    focus,
    recording,
    ready,
    preparing,
    permissionFailed,
    preparePermissions,
    startRecording,
    status,
    exportReport,
  };
}
