import { endHold } from '../scroll-anchor';
import type { FindHit } from './find-hits';

/** Room between the find bar's bottom edge and the first line the reader can read. */
const BAR_GAP_PX = 12;
/** How far into the readable band a revealed match comes to rest. */
const REST_FRACTION = 0.3;
/** Corrections a reveal may make once the turns it scrolled past have taken their real height. */
const CORRECTIONS = 3;
/** Frames a reveal waits for its scroll to settle before it measures again (about 1.5s). */
const SETTLE_FRAMES = 90;
/** Frames a smooth scroll may take to start moving before the view counts as settled. */
const START_FRAMES = 6;
/** Input that means the reader is scrolling themselves, which ends a reveal's corrections. */
const SCROLL_INTENTS = ['wheel', 'touchstart', 'pointerdown'] as const;

/** A vertical stretch of the viewport, in pixels from its top edge. */
export interface Band {
  top: number;
  bottom: number;
}

/** Where `range` starts within the viewport's scrolled content. */
export function contentOffset(viewport: HTMLElement, range: Range): number {
  return (
    range.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
  );
}

/**
 * The part of the viewport the reader can read: below the find bar, which floats over the top of
 * the transcript, and above the composer, which floats over its bottom (its height is the
 * `--overlay-footer-height` the composer publishes on an ancestor).
 */
export function readableBand(viewport: HTMLElement, bar: HTMLElement | null): Band {
  const top = bar
    ? Math.max(0, bar.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top)
    : 0;
  const footer =
    Number.parseFloat(getComputedStyle(viewport).getPropertyValue('--overlay-footer-height')) || 0;
  const start = top + BAR_GAP_PX;
  return { top: start, bottom: Math.max(start, viewport.clientHeight - footer) };
}

/**
 * The match a new query starts at: the first one at or below the top of the readable band, or
 * with none below, the last one above it, which is nearer than the first. Matches are in document
 * order, which is the transcript's vertical order, so a binary search measures only a few.
 */
export function firstInView(viewport: HTMLElement, hits: readonly FindHit[], band: Band): number {
  if (hits.length === 0) return -1;
  const line = viewport.scrollTop + band.top;
  let low = 0;
  let high = hits.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const hit = hits[middle];
    if (hit && contentOffset(viewport, hit.range) >= line) high = middle;
    else low = middle + 1;
  }
  return Math.min(low, hits.length - 1);
}

/**
 * Brings `range` into the readable band, about a third of the way down it, unless it is there
 * already: smoothly, or at once under reduced motion. Turns off screen are laid out at an estimated
 * height until they show (`content-visibility`), so the match can land away from where it was
 * measured; once the scroll settles the reveal measures again and corrects at once, a few times at
 * most. The reader scrolling, or the returned function, stops the corrections.
 */
export function revealRange(
  viewport: HTMLElement,
  range: Range,
  bar: HTMLElement | null,
): () => void {
  const target = (): number | null => {
    const band = readableBand(viewport, bar);
    const rect = range.getBoundingClientRect();
    const top = rect.top - viewport.getBoundingClientRect().top;
    if (top >= band.top && top + rect.height <= band.bottom) return null;
    const rest = band.top + (band.bottom - band.top) * REST_FRACTION;
    const end = viewport.scrollHeight - viewport.clientHeight;
    return Math.min(Math.max(0, viewport.scrollTop + top - rest), end);
  };
  const first = target();
  if (first === null) return () => {};
  // The view is placed here, so a hold keeping another element in place must not pull it back.
  endHold(viewport);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  viewport.scrollTo({ top: first, behavior: reduced ? 'auto' : 'smooth' });

  let frame = 0;
  let corrections = CORRECTIONS;
  let waited = 0;
  let still = 0;
  let moved = false;
  let last = viewport.scrollTop;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of SCROLL_INTENTS) viewport.removeEventListener(type, stop);
  };
  const watch = () => {
    const now = viewport.scrollTop;
    const resting = Math.abs(now - last) < 0.5;
    moved ||= !resting;
    still = resting ? still + 1 : 0;
    last = now;
    waited += 1;
    const settled = moved ? still >= 2 : waited >= START_FRAMES;
    if (!settled && waited < SETTLE_FRAMES) {
      frame = requestAnimationFrame(watch);
      return;
    }
    const next = target();
    if (next === null || corrections <= 0 || Math.abs(next - now) < 1) {
      stop();
      return;
    }
    corrections -= 1;
    viewport.scrollTo({ top: next, behavior: 'auto' });
    still = 0;
    waited = 0;
    moved = false;
    frame = requestAnimationFrame(watch);
  };
  for (const type of SCROLL_INTENTS) viewport.addEventListener(type, stop, { passive: true });
  frame = requestAnimationFrame(watch);
  return stop;
}
