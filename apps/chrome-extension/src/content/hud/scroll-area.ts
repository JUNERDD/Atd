import { h } from '../dom.ts';

/** The thumb stays this long after the last scroll (ms), as a Mac's overlay scrollers do. */
const LINGER_MS = 900;
/** The thumb never gets shorter than this (px), so it stays easy to grab. */
const MIN_THUMB = 24;

/**
 * A vertical scroll area for HUD content taller than its room. `viewport` scrolls as any scroller
 * does (wheel, trackpad, keys while focused, text selection) with its own scrollbar hidden; a thin
 * overlay thumb in the Mac style shows while it scrolls or the pointer is over it, and can be
 * dragged, or pressed along its track to jump there. The thumb's place and the scroll shadows at an
 * edge where content continues are CSS scroll-driven animations (`scroll-area.css`); this keeps
 * only what CSS cannot know: whether the content overflows, the thumb's length, and the drag.
 *
 * Its listeners are on its own elements, so they leave with them. The one ResizeObserver, which
 * keeps the overflow and the thumb's length current, starts when the person first reaches the
 * area (pointer, focus, a scroll) and stops when the area leaves the page: the HUD swaps contents
 * by taking them out, and the observer sees the area's box go.
 *
 * For the HUD's drag the area is a control (`data-control`, `drag.ts`): a press in it selects
 * text or moves the thumb, never the capsule.
 */
export function scrollArea(viewport: HTMLElement, content: HTMLElement): HTMLElement {
  const thumb = h('div', { class: 'scroll-thumb' });
  const track = h('div', { class: 'scroll-track', attrs: { 'aria-hidden': 'true' } }, thumb);
  const area = h('div', { class: 'scroll-area', attrs: { 'data-control': true } }, viewport, track);
  let observer: ResizeObserver | null = null;
  let frame = 0;
  let linger = 0;

  const measure = (): void => {
    const { clientHeight, scrollHeight } = viewport;
    const overflow = scrollHeight - clientHeight >= 1;
    area.toggleAttribute('data-overflow', overflow);
    if (!overflow) return;
    const length = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * track.clientHeight);
    area.style.setProperty('--thumb', `${Math.round(length)}px`);
  };
  const release = (): void => {
    observer?.disconnect();
    observer = null;
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(linger);
    area.removeAttribute('data-scrolling');
  };
  const engage = (): void => {
    if (observer || !area.isConnected) return;
    // Called once per observed box when it starts, so the first frame already knows the overflow.
    observer = new ResizeObserver(() => (area.isConnected ? measure() : release()));
    observer.observe(area);
    observer.observe(content);
  };

  area.addEventListener('pointerenter', engage);
  area.addEventListener('focusin', engage);
  viewport.addEventListener(
    'scroll',
    () => {
      engage();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        area.setAttribute('data-scrolling', '');
        clearTimeout(linger);
        linger = window.setTimeout(() => area.removeAttribute('data-scrolling'), LINGER_MS);
      });
    },
    { passive: true },
  );

  track.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    // Neither text selection nor focus moves with the thumb.
    event.preventDefault();
    const range = viewport.scrollHeight - viewport.clientHeight;
    const travel = track.clientHeight - thumb.offsetHeight;
    if (range <= 0 || travel <= 0) return;
    const perPixel = range / travel;
    if (event.target !== thumb) {
      // A press on the track brings the thumb's middle under the pointer, and drags from there.
      const top = track.getBoundingClientRect().top;
      viewport.scrollTop = (event.clientY - top - thumb.offsetHeight / 2) * perPixel;
    }
    const from = { y: event.clientY, scroll: viewport.scrollTop };
    const move = (moved: PointerEvent): void => {
      viewport.scrollTop = from.scroll + (moved.clientY - from.y) * perPixel;
    };
    const end = (): void => {
      area.removeAttribute('data-dragging');
      track.removeEventListener('pointermove', move);
      track.removeEventListener('lostpointercapture', end);
    };
    track.setPointerCapture(event.pointerId);
    area.setAttribute('data-dragging', '');
    track.addEventListener('pointermove', move);
    // Released on pointerup and pointercancel alike.
    track.addEventListener('lostpointercapture', end);
  });

  return area;
}
