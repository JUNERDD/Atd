import { useEffect, useState, type RefObject } from 'react';

interface InViewOptions {
  rootMargin?: string;
  threshold?: number;
  /** Stop observing after the first time the element enters the viewport. */
  once?: boolean;
}

/**
 * Whether the element intersects the viewport. It is `false` on the server and until the first
 * observation, so use it to start and stop motion or playback, never to hide content: the
 * prerendered page must show everything without it.
 */
export function useInView(
  ref: RefObject<Element | null>,
  { rootMargin = '0px', threshold = 0, once = false }: InViewOptions = {},
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) observer.disconnect();
      },
      { rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, threshold, once]);

  return inView;
}
