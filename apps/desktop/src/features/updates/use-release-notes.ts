import { useEffect, useState } from 'react';
import { onWindowVisible } from '../../window-state';

/** The shell owns eligibility, persistence, and expiry, and replays its pending version. */
export function usePendingReleaseNotes(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => window.desktop?.update?.onReleaseNotes(setVersion), []);
  return version;
}

/** Mount only with the rendered prompt; a hidden native panel must not start its lifetime. */
export function useReleaseNotesShown(version: string): void {
  useEffect(() => {
    function reportVisible() {
      const update = window.desktop?.update;
      if (!update || document.hidden || document.documentElement.dataset.windowVisible !== 'true')
        return;
      // The shell accepts the first valid report. Re-report on reveal in case an earlier
      // message raced native hiding or an update transition and was rejected.
      update.releaseNotesShown(version);
    }
    const unsubscribe = onWindowVisible(reportVisible);
    document.addEventListener('visibilitychange', reportVisible);
    reportVisible();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', reportVisible);
    };
  }, [version]);
}
