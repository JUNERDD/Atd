import { useSyncExternalStore } from 'react';
import { GLOW_STRENGTH } from './glow-field';

const INCREASED_CONTRAST = '(prefers-contrast: more)';
const REDUCED_TRANSPARENCY = '(prefers-reduced-transparency: reduce)';

/**
 * The light's strength for the page's appearance and accessibility settings (`GLOW_STRENGTH`).
 * WebKit has no `prefers-reduced-transparency`, so the shell's report on the root element
 * (`window-state.ts`) counts as well as the media query.
 */
function glowLevel(): number {
  const root = document.documentElement;
  const contrast = window.matchMedia(INCREASED_CONTRAST).matches
    ? GLOW_STRENGTH.increasedContrast
    : 1;
  const transparency =
    root.dataset.reducedTransparency === 'true' || window.matchMedia(REDUCED_TRANSPARENCY).matches
      ? GLOW_STRENGTH.reducedTransparency
      : 1;
  const strength = root.classList.contains('dark') ? GLOW_STRENGTH.dark : GLOW_STRENGTH.light;
  return strength * contrast * transparency;
}

function subscribe(onChange: () => void) {
  const queries = [INCREASED_CONTRAST, REDUCED_TRANSPARENCY].map((query) =>
    window.matchMedia(query),
  );
  for (const query of queries) query.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-reduced-transparency'],
  });
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange);
    observer.disconnect();
  };
}

/** The light's current strength; the component re-renders when a setting it depends on changes. */
export function useGlowLevel(): number {
  return useSyncExternalStore(subscribe, glowLevel);
}
