import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { useReducedMotion } from '../../lib/use-reduced-motion';

/** Fine steps, so the card that is most on screen takes over as soon as it is. */
const THRESHOLDS = Array.from({ length: 21 }, (_, step) => step / 20);

/** How long a scroll started by a control may take before the cards on screen decide again. */
const SETTLE_MS = 900;

/** The gallery's cards, in order: the elements marked `data-case` inside the scroller. */
function cardsOf(viewport: HTMLElement): HTMLElement[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>('[data-case]'));
}

/** Where an arrow, Home or End key moves a gallery of `count` cards from `active`; otherwise `null`. */
export function keyTarget(event: KeyboardEvent, active: number, count: number): number | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  switch (event.key) {
    case 'ArrowLeft':
      return Math.max(active - 1, 0);
    case 'ArrowRight':
      return Math.min(active + 1, count - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

interface Gallery {
  /** The index of the current card: the one most visible in the scroller. */
  active: number;
  /** Scrolls the card at `index` (clamped to the list) to the gallery's start edge. */
  go: (index: number) => void;
}

/**
 * Tracks and moves the current card of a horizontal, scroll-snapped gallery. Scrolling by hand,
 * trackpad, touch or keyboard stays native; an IntersectionObserver on the scroller names the card
 * that is most visible. While a control scrolls to a card, that card stays current and the cards
 * it passes are ignored, so repeated presses keep counting from where the gallery is heading.
 */
export function useGallery(viewportRef: RefObject<HTMLElement | null>, count: number): Gallery {
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState(0);
  const heading = useRef<number | null>(null);
  const settle = useRef(0);
  const mostVisible = useRef<() => number>(() => 0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const cards = cardsOf(viewport);
    const ratios = new Map<Element, number>();
    mostVisible.current = () => {
      let best = 0;
      let bestRatio = -1;
      cards.forEach((card, index) => {
        const ratio = ratios.get(card) ?? 0;
        if (ratio > bestRatio) {
          best = index;
          bestRatio = ratio;
        }
      });
      return best;
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) ratios.set(entry.target, entry.intersectionRatio);
        const best = mostVisible.current();
        if (heading.current !== null) {
          if (best !== heading.current) return;
          heading.current = null;
        }
        setActive(best);
      },
      { root: viewport, threshold: THRESHOLDS },
    );
    for (const card of cards) observer.observe(card);
    return () => {
      observer.disconnect();
      window.clearTimeout(settle.current);
    };
  }, [viewportRef, count]);

  const go = useCallback(
    (index: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const cards = cardsOf(viewport);
      const target = Math.min(Math.max(index, 0), cards.length - 1);
      const card = cards[target];
      const first = cards[0];
      if (!card || !first) return;
      heading.current = target;
      setActive(target);
      window.clearTimeout(settle.current);
      // A scroll the visitor interrupts, or one that is already where it should be, never
      // reports the target; after a while, whatever is on screen is current again.
      settle.current = window.setTimeout(() => {
        heading.current = null;
        setActive(mostVisible.current());
      }, SETTLE_MS);
      // The first card's offset is the track's start padding, which the snap padding matches.
      viewport.scrollTo({
        left: card.offsetLeft - first.offsetLeft,
        behavior: reducedMotion ? 'auto' : 'smooth',
      });
    },
    [viewportRef, reducedMotion],
  );

  return { active, go };
}
