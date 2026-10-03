import { useEffect, type RefObject } from 'react';
import type { SurfaceRect } from '../../client/contract';

/** The element's box in CSS pixels from the viewport's top-left; the shell takes no negatives. */
function measure(element: Element): SurfaceRect {
  const box = element.getBoundingClientRect();
  const x = Math.max(0, box.left);
  const y = Math.max(0, box.top);
  return { x, y, width: Math.max(0, box.right - x), height: Math.max(0, box.bottom - y) };
}

function sameRect(a: SurfaceRect | null, b: SurfaceRect): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * The surface that last placed the guide's glass. The shell has one glass for the whole guide, so
 * a surface takes it over by reporting its own rect (the shell moves shown glass at once), and only
 * the current holder may take it away: a page that stops after another surface took over must not
 * clear that surface's glass.
 */
let holder: object | null = null;

/**
 * Reports a surface (the opening page's or the card's) to the shell (`onboarding.surface`) while
 * `active`, so the shell lays the panel's and Settings' window glass under it: on activation and
 * after every resize of the surface or the window. When it stops (the guide starts closing, or the
 * surface unmounts) it sends `null`, unless another surface has taken the glass since. A changed
 * box is sampled once per frame until two samples agree, so a box still moving under an entrance
 * transform, which ResizeObserver does not see, is sent only at rest. Without the shell's bridge it
 * does nothing.
 */
export function useNativeSurface(
  surface: RefObject<HTMLElement | null>,
  active: boolean,
  radius: number,
) {
  useEffect(() => {
    const bridge = window.desktop?.onboarding;
    const element = surface.current;
    if (!active || !bridge || !element) return;
    const self = {};
    let frame = 0;
    let previous: SurfaceRect | null = null;
    let sent: SurfaceRect | null = null;
    const sample = () => {
      const next = measure(element);
      if (!sameRect(previous, next)) {
        previous = next;
        frame = requestAnimationFrame(sample);
        return;
      }
      frame = 0;
      if (sameRect(sent, next)) return;
      sent = next;
      holder = self;
      bridge.surface(next, radius);
    };
    const schedule = () => {
      if (frame) return;
      previous = null;
      frame = requestAnimationFrame(sample);
    };
    // Its first callback, right after observing, makes the first report.
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (holder !== self) return;
      holder = null;
      bridge.surface(null, radius);
    };
  }, [surface, active, radius]);
}
