import { useEffect, useState } from 'react';

/**
 * Which of the sections behind `hrefs` (`#id` links) is under the reading line, a third of the way
 * down the viewport, or `null` above the first of them (over the hero). Only the sections are
 * observed, against a 1 px band at the line, so scrolling costs nothing between boundaries.
 */
export function useActiveSection(hrefs: readonly string[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = hrefs.join(' ');

  useEffect(() => {
    const sections = key
      .split(' ')
      .map((href) => document.getElementById(href.slice(1)))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;
    const under = new Set<string>();
    let observer: IntersectionObserver | null = null;

    const observe = () => {
      observer?.disconnect();
      under.clear();
      const line = Math.round(innerHeight / 3);
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) under.add(entry.target.id);
            else under.delete(entry.target.id);
          }
          const current = sections.find((section) => under.has(section.id));
          setActive(current ? `#${current.id}` : null);
        },
        { rootMargin: `-${line}px 0px -${Math.max(0, innerHeight - line - 1)}px 0px` },
      );
      for (const section of sections) observer.observe(section);
    };

    observe();
    window.addEventListener('resize', observe, { passive: true });
    return () => {
      window.removeEventListener('resize', observe);
      observer?.disconnect();
    };
  }, [key]);

  return active;
}
