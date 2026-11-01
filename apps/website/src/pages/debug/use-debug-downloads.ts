import { useEffect, useState } from 'react';
import { DEBUG_MANIFEST_URL, parseDebugManifest, type DebugBuild } from './manifest';

type DownloadState =
  | { status: 'loading' | 'unavailable' | 'error' }
  | { status: 'ready'; build: DebugBuild };

/** Loads the independent support channel; a missing or failed read never offers a stable build. */
export function useDebugDownloads() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DownloadState>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    void (async () => {
      try {
        const response = await fetch(DEBUG_MANIFEST_URL, { signal: controller.signal });
        if (response.status === 404) {
          if (current) setState({ status: 'unavailable' });
          return;
        }
        if (!response.ok) throw new Error('Download manifest unavailable.');
        const value: unknown = await response.json();
        const build = parseDebugManifest(value);
        if (current) setState({ status: 'ready', build });
      } catch {
        if (current) setState({ status: 'error' });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  return {
    state,
    retry: () => {
      setState({ status: 'loading' });
      setAttempt((value) => value + 1);
    },
  };
}
