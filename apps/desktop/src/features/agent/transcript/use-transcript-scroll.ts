import { useEffect, useLayoutEffect, useRef, useState, type UIEvent, type WheelEvent } from 'react';

const NEAR_BOTTOM_PX = 16;

function isNearBottom(node: HTMLElement): boolean {
  return node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM_PX;
}

export function useTranscriptScroll(revision: number) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const unpinnedAt = useRef<number | null>(null);
  const revisionRef = useRef(revision);
  const [showJump, setShowJump] = useState(false);

  // Re-arm sticky follow without moving the view. Crossing back near the bottom must never
  // yank the scroll position — only new revisions, resizes while pinned, and the explicit
  // jump action are allowed to write scrollTop.
  const stick = () => {
    pinned.current = true;
    unpinnedAt.current = null;
    setShowJump(false);
  };

  const pin = () => {
    stick();
    const node = viewportRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  };

  const unpin = () => {
    if (!pinned.current) return;
    pinned.current = false;
    unpinnedAt.current = revisionRef.current;
  };

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    if (isNearBottom(node)) stick();
    else unpin();
  };

  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY < 0) unpin();
  };

  useLayoutEffect(() => {
    revisionRef.current = revision;
    const node = viewportRef.current;
    if (!node) return;
    if (pinned.current) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    if (unpinnedAt.current !== null && revision !== unpinnedAt.current) setShowJump(true);
  }, [revision]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { viewportRef, showJump, pin, onScroll, onWheel };
}
