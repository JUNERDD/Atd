import { useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react';

const NEAR_BOTTOM_PX = 16;

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX;
}

export function useTranscriptScroll(revision: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
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
    // Clicks glide to the bottom; live follow and resize paths below stay instant so streaming
    // never lags behind. Reduced-motion users get the instant jump instead of the animation.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.scrollTop = node.scrollHeight;
    } else {
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
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
  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (isNearBottom(node)) stick();
    else unpin();
  };

  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    if (pinned.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [revision]);

  // Layout changes move the bottom without a scroll event: a shrinking transcript (a collapsed
  // group, a capped bubble) clamps scrollTop silently, and a growing viewport reveals the end.
  // Watch both the viewport and its content: pinned follows the bottom, unpinned re-arms once the
  // bottom is back in view so the jump action never outlives the need for it.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) {
        node.scrollTop = node.scrollHeight;
      } else if (isNearBottom(node)) {
        pinned.current = true;
        setShowJump(false);
      }
    });
    observer.observe(node);
    // The ScrollArea viewport wraps its children in one content element, which owns the height.
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return { viewportRef, showJump, pin, onScroll };
}
