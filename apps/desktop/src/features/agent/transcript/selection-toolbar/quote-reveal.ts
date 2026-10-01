import { useEffect } from 'react';
import type { QuoteSource } from '@ai/agent-contracts';
import { paintQuote } from './quote-overlay';
import { findQuote, type FoundQuote } from './quote-source';

/**
 * The longest a reveal lasts (the product allows at most 5s), from the chip's click. Its keyframes
 * (agent.css `quote-reveal`) end sooner and clear it; this bounds a mark whose passage never comes
 * into view or whose animation never ends, such as one painted while the page is hidden.
 */
const MAX_REVEAL_MS = 5000;

/** Transcripts on screen; each answers whether it holds the passage and revealed it. */
const revealers = new Set<(source: QuoteSource) => boolean>();
let clearMark: (() => void) | null = null;

/**
 * Shows the passage a quote chip was taken from in whichever transcript holds it. A chip renders
 * outside the transcript (in the composer's editor or a sent bubble), so it calls this instead of
 * reaching for the transcript. Does nothing when no transcript on screen holds the passage.
 */
export function revealQuote(source: QuoteSource): void {
  for (const reveal of revealers) if (reveal(source)) return;
}

/** The scroll viewport of the transcript around `element`. */
function viewportOf(element: Element) {
  return element.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
}

/**
 * Scrolls the transcript viewport around `root` so the passage's first line sits mid-view:
 * smoothly, or at once under reduced motion.
 */
function scrollTo(root: Element, range: Range) {
  const viewport = viewportOf(root);
  if (!viewport) return;
  const line = range.getClientRects()[0] ?? range.getBoundingClientRect();
  const view = viewport.getBoundingClientRect();
  const wanted =
    viewport.scrollTop + line.top - view.top - (viewport.clientHeight - line.height) / 2;
  const top = Math.min(Math.max(wanted, 0), viewport.scrollHeight - viewport.clientHeight);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  viewport.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' });
}

/**
 * Marks the passage and lets it go: overlay boxes painted into the transcript's reveal `layer`
 * (quote-overlay.ts) wait unseen until one of them scrolls into the viewport, then fade in, hold
 * and fade out together through CSS keyframes (agent.css `quote-reveal`), and leave when that
 * ends, or at `MAX_REVEAL_MS` at the latest (also when the passage never comes into view). A new
 * reveal replaces the previous one.
 */
function mark(layer: HTMLElement, found: FoundQuote) {
  clearMark?.();
  const painted = paintQuote(layer, found);
  const timer = setTimeout(() => clear(), MAX_REVEAL_MS);
  const entered = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      entered.disconnect();
      for (const box of painted) box.dataset.state = 'shown';
    },
    { root: viewportOf(layer) },
  );
  for (const box of painted) entered.observe(box);
  // Every box runs the same keyframes, so the first one's end is the reveal's end.
  painted[0]?.addEventListener('animationend', () => clear(), { once: true });
  const clear = () => {
    if (clearMark !== clear) return;
    clearTimeout(timer);
    entered.disconnect();
    for (const box of painted) box.remove();
    clearMark = null;
  };
  clearMark = clear;
}

// A development reload replaces this module mid-reveal; the outgoing copy removes what it painted.
import.meta.hot?.dispose(() => clearMark?.());

/**
 * Lets quote chips reveal passages in the transcript under `root`, painting them into `layer`, the
 * empty overlay element it renders inside `root`. A covered (inert) transcript declines, so the
 * view on top answers.
 */
export function useQuoteReveal(root: HTMLElement | null, layer: HTMLElement | null) {
  useEffect(() => {
    if (!root || !layer) return;
    const reveal = (source: QuoteSource) => {
      if (root.closest('[inert]')) return false;
      const found = findQuote(root, source);
      if (!found) return false;
      // Painted before the scroll, so the passage fades in as it comes into view.
      mark(layer, found);
      const first = found.ranges[0];
      if (first) scrollTo(root, first);
      return true;
    };
    revealers.add(reveal);
    return () => {
      revealers.delete(reveal);
    };
  }, [root, layer]);
}
