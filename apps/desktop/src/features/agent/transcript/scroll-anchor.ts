/**
 * Input that means the reader is taking over, which ends a hold. It is heard on the whole window:
 * the scrollbar and the jump-to-bottom action sit outside the viewport.
 */
const SCROLL_INTENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * An element and its distance from the top of the scrolled content, as last compensated. Measured
 * in the content rather than the viewport, so only height changes above the element move it: a
 * scroll from anything else (following the bottom, a glide, the scrollbar) leaves it alone, and a
 * hold never fights one.
 */
export type Anchor = { element: Element; top: number };

type Hold = { anchor: Anchor; stop: () => void; release: () => void };

/** One hold per viewport: two would both compensate the same change. */
const holds = new WeakMap<HTMLElement, Hold>();

/**
 * Whether a hold on `held` keeps `element` in place as well: it compensates every change above its
 * own element, so it does when `held` is `element` or comes after it.
 */
function keeps(held: Element, element: Element): boolean {
  if (!held.isConnected) return false;
  return (
    held === element ||
    (element.compareDocumentPosition(held) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
}

/**
 * Each viewport's listener for the scrolls its holds make: the transcript's glide, which moves along
 * with them instead of taking them for the reader.
 */
const scrollListeners = new WeakMap<HTMLElement, (moved: number) => void>();

/**
 * Tells `listener` how far each compensation of a hold on `viewport` scrolled it, until the returned
 * function runs. A viewport has one listener; a newer one replaces it.
 */
export function onHoldScroll(viewport: HTMLElement, listener: (moved: number) => void): () => void {
  scrollListeners.set(viewport, listener);
  return () => {
    if (scrollListeners.get(viewport) === listener) scrollListeners.delete(viewport);
  };
}

export function contentTop(viewport: HTMLElement, element: Element): number {
  return (
    element.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop
  );
}

/**
 * The scroll offset that shows `element` at the top of the view, below its `scroll-margin-top`
 * (the top edge's fade), within the scroll range.
 */
export function revealTop(viewport: HTMLElement, element: Element): number {
  const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
  const bottom = viewport.scrollHeight - viewport.clientHeight;
  return Math.min(Math.max(contentTop(viewport, element) - margin, 0), bottom);
}

export function anchorAt(viewport: HTMLElement, element: Element): Anchor {
  return { element, top: contentTop(viewport, element) };
}

/**
 * Scrolls by whatever grew or shrank above the anchor's element, so the element stays in place, and
 * reports how far the view actually moved (the range clamps it, and offsets round).
 */
function compensate(viewport: HTMLElement, held: Anchor) {
  if (!held.element.isConnected) return;
  const top = contentTop(viewport, held.element);
  if (top !== held.top) {
    const from = viewport.scrollTop;
    viewport.scrollTop += top - held.top;
    scrollListeners.get(viewport)?.(viewport.scrollTop - from);
  }
  held.top = top;
}

/**
 * Holds the anchor's element in place while content above it changes height (turns mounted above
 * it, lazy markdown, code highlighting and diagrams settling, estimated turn heights resolving),
 * starting by putting it back at `anchor.top`. Growth below it is never compensated, so a view
 * pinned to the bottom keeps following it. Each scroll it makes goes to the viewport's listener
 * (`onHoldScroll`), so a glide under way moves along with the content.
 *
 * The reader taking over with the wheel, a touch, a key or a click releases the hold, and so does
 * a newer hold on the same viewport; `onRelease` runs then. A newer hold whose element the active
 * one keeps in place already replaces nothing: the active hold compensates at once and stays, so a
 * message revealed below the turn a load anchors keeps its place, and the newer hold ends there
 * (`onRelease` runs). The returned function only stops the hold: an owner that holds the same
 * anchor again after its next commit keeps it.
 */
export function holdInView(
  viewport: HTMLElement,
  anchor: Anchor,
  onRelease?: () => void,
): () => void {
  const active = holds.get(viewport);
  if (active && keeps(active.anchor.element, anchor.element)) {
    compensate(viewport, active.anchor);
    onRelease?.();
    return () => {};
  }
  active?.release();
  compensate(viewport, anchor);
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => compensate(viewport, anchor));
  // The ScrollArea viewport wraps its children in one content element, which owns the height.
  if (viewport.firstElementChild) observer?.observe(viewport.firstElementChild);
  const hold: Hold = {
    anchor,
    stop() {
      if (holds.get(viewport) === hold) holds.delete(viewport);
      observer?.disconnect();
      for (const type of SCROLL_INTENTS) window.removeEventListener(type, hold.release, true);
    },
    release() {
      hold.stop();
      onRelease?.();
    },
  };
  holds.set(viewport, hold);
  for (const type of SCROLL_INTENTS)
    window.addEventListener(type, hold.release, { capture: true, passive: true });
  return hold.stop;
}

/** Releases the viewport's hold, if any, for a scroll that places the view itself. */
export function endHold(viewport: HTMLElement): void {
  holds.get(viewport)?.release();
}
