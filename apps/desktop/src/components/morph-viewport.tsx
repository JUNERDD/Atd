import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './morph-viewport.css';

/**
 * Sizes itself to its current content and transitions between sizes when the content changes,
 * the way a navigation menu's viewport morphs from one menu to the next. The content lays out
 * at its own size (it is absolutely positioned), so each view keeps its width and height; the
 * measured size reaches CSS as custom properties, set before the first paint so opening does
 * not animate from zero.
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
    // The border box ignores the popover's open zoom, which a bounding rect would include.
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (box) apply(box.inlineSize, box.blockSize);
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
