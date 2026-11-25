import type { Surfaces } from './surfaces.ts';

/** How long a freshly injected content script gets to say `ready`. */
const READY_TIMEOUT_MS = 1_500;

/**
 * The content script in tabs that lack it: tabs open before the extension loaded or updated, where
 * Chrome does not inject the manifest's content script by itself. The script guards against a
 * second copy in the same document, so injecting where one already runs is harmless.
 */
export class ContentInjector {
  constructor(private readonly surfaces: Surfaces) {}

  /** True once the tab's content script is ready; false where it cannot run. */
  async ensure(tabId: number): Promise<boolean> {
    if (this.surfaces.hasContent(tabId)) return true;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const file = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
    if (tab === undefined || file === undefined || !(await canRunIn(tab.url ?? ''))) return false;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (error) {
      // Pages Chrome keeps from extensions (the Web Store, other extensions' pages, error pages).
      console.info(`[atd] could not reach tab ${tabId}`, error);
      return false;
    }
    return this.surfaces.waitForContent(tabId, READY_TIMEOUT_MS);
  }
}

/** Web pages, and local files once the person allowed file URLs; never browser pages. */
async function canRunIn(url: string): Promise<boolean> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  if (protocol === 'http:' || protocol === 'https:') return true;
  return protocol === 'file:' && (await chrome.extension.isAllowedFileSchemeAccess());
}

/**
 * Opens the in-page ask (the ask shortcut, ⇧⌘K by default, or the popup's "Ask Atd on This
 * Page…"). Unpaired, the popup opens instead, where Connect… is; Chrome may refuse that outside a
 * user gesture, which leaves nothing to do. Paired, the tab's content script opens the input at
 * the HUD's place.
 */
export async function openAsk(
  tabId: number,
  paired: boolean,
  injector: ContentInjector,
  surfaces: Surfaces,
): Promise<void> {
  if (!paired) {
    await chrome.action.openPopup().catch(() => undefined);
    return;
  }
  if (await injector.ensure(tabId)) surfaces.postToTab(tabId, { type: 'ask.open' });
}
