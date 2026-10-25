import { useEffect, useEffectEvent, type RefObject } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders-react';
import { onWindowVisible } from '../window-state';

/** The longest step the clock takes, so a light resumes where it paused after a hidden spell. */
const MAX_STEP_MS = 50;

/**
 * Drives a paused Paper shader (`speed={0}`) from `start` ms of its time, at most once per
 * `frameMs`. The native panel hides at alpha zero without hiding the document; pause on either
 * visibility signal. Each step is at most `MAX_STEP_MS`. Every run
 * starts at `start`, and a stopped clock returns the shader there, so a light that rests between
 * runs already shows its first frame when it runs again.
 *
 * `fullRateMs` draws every display frame for that long from the start of each run before the
 * clock settles to `frameMs`: a light whose entry moves quickly would otherwise step visibly at the
 * slower rate while the CSS around it animates at the display's.
 * A draw can return true while another brief transition needs the display's full rate.
 */
export function useShaderClock(
  ref: RefObject<PaperShaderElement | null>,
  start: number,
  run: boolean,
  frameMs: number,
  fullRateMs = 0,
  draw?: (element: PaperShaderElement, milliseconds: number) => boolean | void,
) {
  const paint = useEffectEvent((element: PaperShaderElement, milliseconds: number) => {
    if (draw) return draw(element, milliseconds) === true;
    element.paperShaderMount?.setFrame(milliseconds);
    return false;
  });
  useEffect(() => {
    if (!run) return;
    // The shader's element for this run; Paper attaches its mount to it once set up.
    const element = ref.current;
    let frame = 0;
    let clock = start;
    let last = performance.now();
    let fullRate = false;
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      // Two milliseconds of slack, so a display's own frames at the target rate are never skipped.
      if (!fullRate && clock - start >= fullRateMs && now - last < frameMs - 2) return;
      clock += Math.min(now - last, MAX_STEP_MS);
      last = now;
      // Paper sets the mount up once it has processed the uniforms, just after the first render.
      if (element) fullRate = paint(element, clock);
    }
    const syncVisibility = () => {
      cancelAnimationFrame(frame);
      last = performance.now();
      if (!document.hidden && document.documentElement.dataset.windowVisible !== 'false') {
        frame = requestAnimationFrame(tick);
      }
    };
    if (element) paint(element, start);
    const unsubscribe = onWindowVisible(syncVisibility);
    document.addEventListener('visibilitychange', syncVisibility);
    syncVisibility();
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', syncVisibility);
      cancelAnimationFrame(frame);
      if (element) paint(element, start);
    };
  }, [ref, start, run, frameMs, fullRateMs]);
}
