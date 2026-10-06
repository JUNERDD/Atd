import { useEffect } from 'react';
import { initGridHalo } from './grid-halo';
import { initReveal } from './reveal';

/**
 * Starts the page's motion once it has hydrated: the reveal controller and the grid halo. Runs from
 * the app root, whose effects run after every section's, so sections' listeners are in place first.
 */
export function usePageMotion(): void {
  useEffect(() => {
    const stopReveal = initReveal();
    const stopHalo = initGridHalo();
    return () => {
      stopReveal();
      stopHalo();
    };
  }, []);
}
