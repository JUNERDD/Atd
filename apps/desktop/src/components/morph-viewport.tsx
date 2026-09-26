import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './morph-viewport.css';

/**
 * Sizes itself to its current content and transitions between sizes when the content changes,
 * the way a navigation menu's viewport morphs from one menu to the next. The content lays out
 * at its own size (it is absolutely positioned), so each view keeps its width and height; the
 * measured size reaches CSS as custom properties, set before the first paint so opening does
 * not animate from zero or from a provisional size.
 */
export function MorphViewport({ children }: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const outer = viewport.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const apply = (width: number, height: number) => {
      outer.style.setProperty('--morph-viewport-width', `${width}px`);
      outer.style.setProperty('--morph-viewport-height', `${height}px`);
    };
    apply(inner.offsetWidth, inner.offsetHeight);
    // The first report still belongs to opening and lands without a transition: content sized
    // from its overlay's placement (the HITL view spans the anchor through a width Radix sets
    // once positioned) measures its provisional size above, and would otherwise grow from it.
    let placed = false;
    // The border box ignores the popover's open zoom, which a bounding rect would include.
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (!box) return;
      if (placed) {
        apply(box.inlineSize, box.blockSize);
        return;
      }
      placed = true;
      outer.dataset.instant = '';
      apply(box.inlineSize, box.blockSize);
      // Commits the size while transitions are off, so removing the flag animates nothing.
      void outer.offsetWidth;
      delete outer.dataset.instant;
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={viewport} className="morph-viewport">
      <div ref={content} className="morph-viewport-content">
        {children}
      </div>
    </div>
  );
}
