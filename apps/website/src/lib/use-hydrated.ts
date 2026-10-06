import { useSyncExternalStore } from 'react';

const subscribeNever = () => () => {};

/**
 * `false` in the prerendered markup and while hydrating it, `true` once the page runs. Controls that
 * need script use it to stay out of the way until they work.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}
