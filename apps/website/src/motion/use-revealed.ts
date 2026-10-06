import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether the reveal controller has revealed the element (a `data-reveal` item or a
 * `data-reveal-group`): `false` on the server and until then, `true` from the moment its entrance
 * starts. Use it to start a demo's own sequence; with reduced motion it still turns true when the
 * element arrives, and the demo should then show its end state without the motion.
 */
export function useRevealed(ref: RefObject<Element | null>): boolean {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (element.hasAttribute('data-revealed')) {
      setRevealed(true);
      return;
    }
    const observer = new MutationObserver(() => {
      if (!element.hasAttribute('data-revealed')) return;
      setRevealed(true);
      observer.disconnect();
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-revealed'] });
    return () => observer.disconnect();
  }, [ref]);

  return revealed;
}
