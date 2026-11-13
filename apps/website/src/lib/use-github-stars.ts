import { useEffect, useState } from 'react';
import { site } from '../content/site';
import { parseApiStars } from './github-stars';

/**
 * Starts with the build/hydration snapshot so the header pill never shifts width on load, then
 * refreshes from the same-origin cached `/api/github` endpoint when active in a browser.
 */
export function useGitHubStars(initialStars: number): number {
  const [stars, setStars] = useState(initialStars);

  useEffect(() => {
    const controller = new AbortController();
    fetch(site.starCountUrl, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const latest = parseApiStars(payload);
        if (latest !== null) setStars(latest);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return stars;
}
