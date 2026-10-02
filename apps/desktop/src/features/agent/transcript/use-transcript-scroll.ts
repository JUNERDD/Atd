import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';
import { followValue, type SpringOptions } from 'motion/react';

const NEAR_BOTTOM_PX = 16;
/** A scroll event this close to the glide's last write is the glide's own echo. */
const GLIDE_ECHO_PX = 1;
/**
 * Critically damped (damping = 2 * sqrt(stiffness) at unit mass), so the glide never overshoots
 * a bottom the scroll range would clamp; it is visually there in about half a second. Physical
 * parameters rather than `visualDuration`: re-aiming a duration-defined spring loses momentum.
 */
const GLIDE: SpringOptions = { stiffness: 170, damping: 26, restDelta: 0.5, restSpeed: 10 };

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX;
}

function bottomOf(node: HTMLElement): number {
  return node.scrollHeight - node.clientHeight;
}

/**
 * The jump action's glide: a spring on scrollTop aimed at the bottom. `followValue` steers a
 * running spring to a new target with its current velocity, so content streaming in under the
 * glide extends it instead of snapping the view or restarting the motion.
 */
function createGlide() {
  const y = followValue<number>(0, { type: 'spring', ...GLIDE });
  let viewport: HTMLElement | null = null;
  let written = 0;
  y.on('change', (value) => {
    if (!viewport) return;
    viewport.scrollTop = value;
    written = viewport.scrollTop;
  });
  return {
    get running() {
      return y.isAnimating();
    },
    start(node: HTMLElement) {
      viewport = node;
      y.jump(node.scrollTop);
      y.set(bottomOf(node));
    },
    /**
     * Pinned follow: instant so streaming never lags behind, except under a running glide, which
     * is re-aimed at the new bottom instead of cut off.
     */
    follow(node: HTMLElement) {
      if (y.isAnimating()) y.set(bottomOf(node));
      else node.scrollTop = node.scrollHeight;
    },
    /** Whether the view moved away from the glide's last write: wheel, keys, the scrollbar. */
    isOverridden(node: HTMLElement) {
      return Math.abs(node.scrollTop - written) > GLIDE_ECHO_PX;
    },
    stop() {
      y.stop();
    },
  };
}

export function useTranscriptScroll(revision: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  // While it runs, the glide's intermediate scroll events sit above the bottom and must not read
  // as the reader leaving it, or the jump action would reappear mid-glide.
  const [glide] = useState(createGlide);
  const [showJump, setShowJump] = useState(false);

  // Re-arm sticky follow without moving the view. Crossing back near the bottom must never
  // yank the scroll position — only new revisions, resizes while pinned, and the explicit
  // scroll-to-bottom action are allowed to write scrollTop.
  const stick = () => {
    pinned.current = true;
    setShowJump(false);
  };

  const pin = () => {
    stick();
    const node = viewportRef.current;
    if (!node) return;
    // Reduced-motion users get the instant jump instead of the glide.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.scrollTop = node.scrollHeight;
    } else {
      glide.start(node);
    }
  };

  const unpin = () => {
    if (!pinned.current) return;
    pinned.current = false;
    setShowJump(true);
  };

  // Scroll position is the single owner of pinned/showJump. Do not add a wheel (or other
  // intent) fast-path that unpins without a position check: inside the near-bottom zone it
  // commits show while the trailing scroll event commits hide, which flickers per wheel tick.
  // The glide is told apart by position too: a scroll away from its last write is the reader
  // taking over, which ends it, and the same event's position then decides as usual.
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (glide.running && glide.isOverridden(node)) glide.stop();
    if (isNearBottom(node)) stick();
    else if (!glide.running) unpin();
  };

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    if (pinned.current) glide.follow(node);
  }, [revision, glide]);

  // Layout changes move the bottom without a scroll event: a shrinking transcript (a collapsed
  // group, a capped bubble) clamps scrollTop silently, and a growing viewport reveals the end.
  // Watch both the viewport and its content: pinned follows the bottom, unpinned re-arms once the
  // bottom is back in view so the jump action never outlives the need for it.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) {
        glide.follow(node);
      } else if (isNearBottom(node)) {
        pinned.current = true;
        setShowJump(false);
      }
    });
    observer.observe(node);
    // The ScrollArea viewport wraps its children in one content element, which owns the height.
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [glide]);

  useEffect(() => () => glide.stop(), [glide]);

  return { viewportRef, showJump, pin, onScroll };
}
