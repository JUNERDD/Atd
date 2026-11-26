import { useEffect, useState } from 'react';
import { pageOf, type ActivePage } from './model.ts';

function samePage(a: ActivePage, b: ActivePage): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The tab the panel's window shows, followed while the panel is open: the side panel stays beside
 * the window's tabs as the person switches tabs and as the tab navigates. Only the latest read
 * counts, since an earlier one may finish after it.
 */
export function useActivePage(): ActivePage {
  const [page, setPage] = useState<ActivePage>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    let reads = 0;
    let windowId: number | undefined;
    const read = async (): Promise<void> => {
      const current = ++reads;
      let next: ActivePage;
      try {
        windowId ??= (await chrome.windows.getCurrent()).id;
        const [tab] = await chrome.tabs.query({ active: true, windowId });
        next = pageOf(tab);
      } catch {
        next = { kind: 'other', tabId: null };
      }
      if (live && current === reads) setPage((shown) => (samePage(shown, next) ? shown : next));
    };
    const ofWindow = (id: number): boolean => windowId === undefined || id === windowId;
    const activated = (info: chrome.tabs.OnActivatedInfo): void => {
      if (ofWindow(info.windowId)) void read();
    };
    const updated = (_: number, change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab): void => {
      if (tab.active && ofWindow(tab.windowId) && change.url !== undefined) void read();
    };
    const replaced = (): void => void read();
    chrome.tabs.onActivated.addListener(activated);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onReplaced.addListener(replaced);
    void read();
    return () => {
      live = false;
      chrome.tabs.onActivated.removeListener(activated);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onReplaced.removeListener(replaced);
    };
  }, []);
  return page;
}
