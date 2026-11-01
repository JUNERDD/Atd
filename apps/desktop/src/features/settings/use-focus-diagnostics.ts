import { useEffect, useState } from 'react';

export function useFocusDiagnostics() {
  const bridge = window.desktop?.diagnostics;
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<'idle' | 'exporting' | 'saved' | 'failed'>('idle');
  useEffect(() => {
    let current = true;
    void bridge?.state().then(
      (state) => {
        if (current) setEnabled(state.enabled);
      },
      () => {
        if (current) setEnabled(false);
      },
    );
    return () => {
      current = false;
    };
  }, [bridge]);
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
  return { enabled, status, exportReport };
}
