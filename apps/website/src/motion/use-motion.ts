import { useEffect } from 'react';
import { initReveal } from './reveal';

/**
 * Starts the page's reveal controller once it has hydrated. Runs from the app root, whose effects
 * run after every section's, so sections' listeners are in place first.
 */
export function usePageMotion(): void {
  useEffect(() => {
    const stopReveal = initReveal();
    return () => {
      stopReveal();
    };
  }, []);
}
