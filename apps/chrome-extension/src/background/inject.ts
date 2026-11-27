import { openPanel } from './action-surface.ts';
import type { Surfaces } from './surfaces.ts';

/** How long a freshly injected content script gets to say `ready`. */
const READY_TIMEOUT_MS = 1_500;

/**
 * The content script in tabs that lack it: tabs open before the extension loaded or updated, where
 * Chrome does not inject the manifest's content script by itself. The script guards against a
 * second copy in the same document, so injecting where one already runs is harmless.
 */
export class ContentInjector {
  /** Whether the person allowed file URLs, as last read (unknown until the first read returns). */
  private fileAccess: boolean | undefined;

  constructor(private readonly surfaces: Surfaces) {
    this.readFileAccess().catch(() => undefined);
  }

  /**
   * Whether the content script can run in `tab` as far as this worker knows now, without awaiting
   * anything (a click's gesture would not survive it): its script said `ready`, or the tab shows a
   * web page Chrome lets extensions script, or a local file once the person allowed file URLs. A
   * worker the click just woke may not have read that setting yet, and counts a file as out of
   * reach until it has.
   */
  reaches(tab: chrome.tabs.Tab): boolean {
    if (tab.id !== undefined && this.surfaces.hasContent(tab.id)) return true;
    return scriptable(tab.url ?? '', this.fileAccess === true);
  }

  /** True once the tab's content script is ready; false where it cannot run. */
  async ensure(tabId: number): Promise<boolean> {
    if (this.surfaces.hasContent(tabId)) return true;
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const file = chrome.runtime.getManifest().content_scripts?.[0]?.js?.[0];
    if (tab === undefined || file === undefined) return false;
    if (!scriptable(tab.url ?? '', await this.readFileAccess())) return false;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    } catch (error) {
      // Pages Chrome keeps from extensions that a URL does not tell (error pages, blocked hosts).
      console.info(`[atd] could not reach tab ${tabId}`, error);
      return false;
    }
    return this.surfaces.waitForContent(tabId, READY_TIMEOUT_MS);
  }

  private async readFileAccess(): Promise<boolean> {
    this.fileAccess = await chrome.extension.isAllowedFileSchemeAccess();
    return this.fileAccess;
  }
}

/**
 * Web pages other than the Web Store (Chrome keeps every extension off it), and local files once
 * the person allowed file URLs; never browser pages (chrome://, the new tab page), other
 * extensions' pages, or anything else.
 */
function scriptable(url: string, fileAccess: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === 'file:') return fileAccess;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const { hostname, pathname } = parsed;
  const store =
    hostname === 'chromewebstore.google.com' ||
    (hostname === 'chrome.google.com' && pathname.startsWith('/webstore'));
  return !store;
}

/**
 * Opens the in-page ask in `tab` (the toolbar button with its `ask` choice, or the ask shortcut
 * ⇧⌘K by default), or closes it where it shows: the tab's content script shows it at the HUD's
 * place in every connection state, saying why when Atd cannot take a request. Where the script
 * turns out not to run after all, Atd's panel opens instead; Chrome may refuse that this long after
 * the person's action, which leaves nothing more to do.
 */
export async function openAsk(
  tab: { id: number; windowId: number },
  injector: ContentInjector,
  surfaces: Surfaces,
): Promise<void> {
  if ((await injector.ensure(tab.id)) && surfaces.postToTab(tab.id, { type: 'ask.open' })) return;
  await openPanel({ windowId: tab.windowId });
}
