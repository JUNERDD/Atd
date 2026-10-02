import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import './morph-viewport.css';

/** A new view fades in a little faster than the viewport's 200ms resize around it. */
const FADE_MS = 160;

/**
 * Sizes itself to its current content and transitions between sizes when the content changes,
 * the way a navigation menu's viewport morphs from one menu to the next. The content lays out
 * at its own size (it is absolutely positioned), so each view keeps its width and height; the
 * measured size reaches CSS as custom properties, set before the first paint.
 *
 * The overlay that hosts it owns opening and closing, so the viewport morphs only in between:
 * - until `morph` turns on (the overlay is still placing itself and running its own enter
 *   animation) every size lands at once, so the overlay opens at its final size instead of
 *   growing from a provisional one (content sized from its overlay's placement, such as a width
 *   Radix sets once positioned, measures a provisional size first);
 * - once `morph` is on, size changes transition and a new `view` fades in;
 * - while `open` is off the viewport keeps the content it last showed open, so the overlay's exit
 *   animation shows what was there instead of the content collapsing under it (a resolved
 *   request, for example, leaves its view at once).
 */
export function MorphViewport({
  view,
  open,
  morph,
  children,
}: {
  /** Which content shows; a change while morphing fades the new content in. */
  view: string | null;
  open: boolean;
  morph: boolean;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(children);
  if (open && held !== children) setHeld(children);
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const outer = viewport.current;
    const inner = content.current;
    if (!outer || !inner) return;
    const apply = (width: number, height: number) => {
      outer.style.setProperty('--morph-viewport-width', `${width}px`);
      outer.style.setProperty('--morph-viewport-height', `${height}px`);
    };
    apply(inner.offsetWidth, inner.offsetHeight);
    // The border box ignores the overlay's open zoom, which a bounding rect would include.
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.borderBoxSize[0];
      if (box) apply(box.inlineSize, box.blockSize);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const shownView = useRef(view);
  useLayoutEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    if (morph && !reduced)
      content.current?.animate({ opacity: [0, 1] }, { duration: FADE_MS, easing: 'ease-out' });
  }, [view, morph, reduced]);

  return (
    <div ref={viewport} className="morph-viewport" data-instant={morph ? undefined : ''}>
      <div ref={content} className="morph-viewport-content" inert={!open}>
        {open ? children : held}
      </div>
    </div>
  );
}
