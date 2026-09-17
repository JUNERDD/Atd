import { useCallback } from 'react';

/**
 * Ref for a bottom action bar that floats over the surface's scrolling content (`.overlay-footer`).
 * Publishes the bar's measured height as `--overlay-footer-height` on the bar's parent so the
 * surface can reserve enough trailing space and fade the content behind the bar.
 */
export function useOverlayFooter<T extends HTMLElement>() {
  return useCallback((footer: T | null) => {
    const surface = footer?.parentElement;
    if (!footer || !surface) return;
    const sync = () =>
      surface.style.setProperty('--overlay-footer-height', `${footer.offsetHeight}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      surface.style.removeProperty('--overlay-footer-height');
    };
  }, []);
}
