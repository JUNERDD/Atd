import { lazy, useState, type ComponentType } from 'react';

/**
 * A code-split component that renders synchronously once `preload` has settled. `React.lazy`
 * suspends on its first render even when its chunk is already loaded, and a committed Suspense
 * fallback holds the content back by React's fallback throttle (300 ms); preloading when the
 * surface that may show it mounts avoids both. Before the chunk loads it behaves like
 * `React.lazy`, so it still renders inside a Suspense boundary. A small local helper rather than
 * `react-lazy-with-preload`, which has not been released since 2022 and does not declare React 19.
 */
export function lazyWithPreload<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const preload = () =>
    (pending ??= load().then((component) => {
      loaded = component;
      return component;
    }));
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function Preloadable(props: P) {
    // Fixed per instance: swapping the lazy wrapper for the loaded type would remount the subtree.
    const [Component] = useState<ComponentType<P>>(() => loaded ?? Lazy);
    return <Component {...props} />;
  }
  return { Component: Preloadable, preload };
}
