import { useSyncExternalStore } from 'react';

/** The page's effective theme: the `dark` class on the root element, or its absence. */
export type ColorScheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * Applies the system color scheme to the page: `.dark` on the root element while
 * `prefers-color-scheme` is dark, updated live. The shell sets the app's appearance from the
 * user's theme setting, so the media query already reflects light, dark or the system choice.
 * Runs before the first render; the returned function stops following changes.
 */
export function installColorScheme(): () => void {
  const query = window.matchMedia(DARK_QUERY);
  const apply = () => document.documentElement.classList.toggle('dark', query.matches);
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}

/** The current scheme, for callers outside React. */
export function currentColorScheme(): ColorScheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** The current scheme; the component re-renders when it changes. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribe, currentColorScheme);
}
