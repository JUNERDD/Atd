import { useEffect, type RefObject } from 'react';
import type { PaperShaderElement } from '@paper-design/shaders-react';

/** The longest step the clock takes, so a light resumes where it paused after a hidden spell. */
const MAX_STEP_MS = 50;

/**
 * Drives a paused Paper shader (`speed={0}`) from `start` ms of its time, at most once per
 * `frameMs`. WebKit stops animation frames while the window is hidden, and each step is at most
 * `MAX_STEP_MS`, so the light pauses with the window instead of jumping when it returns. Every run
 * starts at `start`, and a stopped clock returns the shader there, so a light that rests between
 * runs already shows its first frame when it runs again.
 *
 * `fullRateMs` draws every display frame for that long from the start of each run before the
 * clock settles to `frameMs`: a light whose entry moves quickly would otherwise step visibly at the
 * slower rate while the CSS around it animates at the display's.
 */
export function useShaderClock(
  ref: RefObject<PaperShaderElement | null>,
  start: number,
  run: boolean,
  frameMs: number,
  fullRateMs = 0,
) {
  useEffect(() => {
    if (!run) return;
    // The shader's element for this run; Paper attaches its mount to it once set up.
    const element = ref.current;
    let frame = 0;
    let clock = start;
    let last = performance.now();
    function tick(now: number) {
      frame = requestAnimationFrame(tick);
      // Two milliseconds of slack, so a display's own frames at the target rate are never skipped.
      if (clock - start >= fullRateMs && now - last < frameMs - 2) return;
      clock += Math.min(now - last, MAX_STEP_MS);
      last = now;
      // Paper sets the mount up once it has processed the uniforms, just after the first render.
      element?.paperShaderMount?.setFrame(clock);
    }
    element?.paperShaderMount?.setFrame(start);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      element?.paperShaderMount?.setFrame(start);
    };
  }, [ref, start, run, frameMs, fullRateMs]);
}
