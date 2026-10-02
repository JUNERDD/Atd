import { useEffect, useState } from 'react';

/** Within this distance of the end the reader counts as following the newest text. */
const NEAR_BOTTOM_PX = 16;

/**
 * Keeps an open reasoning trace on its newest text while it streams: whenever the content grows,
 * its scroll area moves to the end, unless the reader has scrolled up; scrolling back to the end
 * resumes following. Scroll position alone decides, so there is no intent fast path to disagree
 * with it, and the move is instant, so the view never lags the stream or animates.
 *
 * Returns a callback ref for an element inside the `DetailBox`. `ToolCard.Body` owns the
 * `ScrollArea` and does not expose its viewport, so the hook finds the viewport from the content
 * through the scroll area's `data-slot` contract. Each opening starts following again.
 */
export function useFollowStream(active: boolean) {
  const [content, setContent] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !content || typeof ResizeObserver === 'undefined') return;
    const viewport = content.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
    if (!viewport) return;
    let following = true;
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      following = distance <= NEAR_BOTTOM_PX;
    };
    // The first callback fires on observe, so opening a streaming trace lands on its end.
    const observer = new ResizeObserver(() => {
      if (following) viewport.scrollTop = viewport.scrollHeight;
    });
    viewport.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      observer.disconnect();
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [active, content]);
  return setContent;
}
