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

/**
 * Conditional fade reserve for a covered viewport. The unconditional
 * `.overlay-footer-fade` padding manufactures dead scroll range (and a scrollbar) whenever
 * content fits but content plus reserve does not, so this publishes `data-reserve="off"` on
 * the viewport while the last row already clears the floating bar, and removes it otherwise.
 * Absence of the attribute preserves the full reserve, so surfaces that never opt in keep
 * current behavior. The decision inputs (content, viewport, footer heights) do not depend on
 * the decision itself, so the toggle cannot oscillate.
 */
export function useOverlayReserve<T extends HTMLElement>() {
  return useCallback((viewport: T | null) => {
    if (!(viewport instanceof HTMLElement)) return;
    const footer = viewport.closest('main')?.querySelector('footer.overlay-footer');
    const sync = () => {
      const inner = viewport.firstElementChild;
      const box = inner instanceof HTMLElement ? inner : null;
      const style = getComputedStyle(viewport);
      const footerH = parseFloat(style.getPropertyValue('--overlay-footer-height')) || 0;
      const padNow = box ? parseFloat(getComputedStyle(box).paddingBottom) || 0 : 0;
      const contentH = (box?.scrollHeight ?? 0) - padNow;
      if (contentH <= viewport.clientHeight - footerH) viewport.dataset.reserve = 'off';
      else delete viewport.dataset.reserve;
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(viewport);
    const box = viewport.firstElementChild;
    if (box instanceof HTMLElement) observer.observe(box);
    if (footer instanceof HTMLElement) observer.observe(footer);
    return () => {
      observer.disconnect();
      delete viewport.dataset.reserve;
    };
  }, []);
}
