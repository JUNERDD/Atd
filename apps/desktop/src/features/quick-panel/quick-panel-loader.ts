import { lazyWithPreload } from '../../lib/lazy-with-preload';

const quickPanel = lazyWithPreload(() =>
  import('./quick-panel').then((module) => module.QuickPanel),
);

export const LazyQuickPanel = quickPanel.Component;

/** Preloads the composer quick panel chunk before the user types `/` or `@`. */
export function preloadQuickPanel(): Promise<unknown> {
  return quickPanel.preload();
}
