import { useEffect, useState } from 'react';
import type { AppAbout } from '../../client/contract';

/**
 * The running app as the shell reports it: `loading` until it answers, `unavailable` without a
 * shell (tests) or when it could not answer. The details never change while the app runs, so they
 * are read once per mount.
 */
export function useAppAbout():
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; about: AppAbout } {
  const bridge = window.desktop?.about;
  const [about, setAbout] = useState<AppAbout | null | undefined>(bridge ? undefined : null);

  useEffect(() => {
    if (!bridge) return;
    let current = true;
    bridge.info().then(
      (value) => {
        if (current) setAbout(value);
      },
      (error: unknown) => {
        console.error('The app could not report its version:', error);
        if (current) setAbout(null);
      },
    );
    return () => {
      current = false;
    };
  }, [bridge]);

  if (about === undefined) return { state: 'loading' };
  return about ? { state: 'ready', about } : { state: 'unavailable' };
}
