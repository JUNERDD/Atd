import { useEffect, useState, type RefObject } from 'react';

export type NavTone = 'ink' | 'paper';

/**
 * Which kind of section lies under the floating bar, so its glass can follow the backdrop the way
 * Liquid Glass does: light over the paper section, dark everywhere else. Only the paper sections are
 * observed, against a 1 px band through the bar's center, so scrolling costs nothing until a section
 * boundary crosses the bar.
 */
export function useNavTone(bar: RefObject<HTMLElement | null>): NavTone {
  const [tone, setTone] = useState<NavTone>('ink');

  useEffect(() => {
    const papers = document.querySelectorAll('.section[data-tone="paper"]');
    if (papers.length === 0) return;
    let observer: IntersectionObserver | null = null;
    let frame = 0;
    const under = new Set<Element>();

    const observe = () => {
      frame = 0;
      const box = bar.current?.getBoundingClientRect();
      if (!box) return;
      const center = Math.round(box.top + box.height / 2);
      observer?.disconnect();
      under.clear();
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) under.add(entry.target);
            else under.delete(entry.target);
          }
          setTone(under.size > 0 ? 'paper' : 'ink');
        },
        { rootMargin: `-${center}px 0px -${Math.max(0, innerHeight - center - 1)}px 0px` },
      );
      for (const paper of papers) observer.observe(paper);
    };
    const onResize = () => {
      if (!frame) frame = requestAnimationFrame(observe);
    };

    observe();
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [bar]);

  return tone;
}
