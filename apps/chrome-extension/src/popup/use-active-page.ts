import { useEffect, useState } from 'react';
import { pageOf, type ActivePage } from './model.ts';

/**
 * The tab the popup was opened over. Read once: Chrome closes the popup when the person switches
 * tabs or windows, so the answer cannot go stale while it is shown.
 */
export function useActivePage(): ActivePage {
  const [page, setPage] = useState<ActivePage>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    chrome.tabs.query({ active: true, currentWindow: true }).then(
      ([tab]) => {
        if (live) setPage(pageOf(tab));
      },
      () => {
        if (live) setPage({ kind: 'other' });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return page;
}
