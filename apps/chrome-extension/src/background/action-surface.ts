import { POPUP_SEARCH } from '../messages/ports.ts';
import type { ToolbarAction } from '../messages/settings.ts';
import type { PanelSurface } from '../messages/views.ts';

/**
 * Where the toolbar button leads. Where the browser has Chrome's side panel, the button has no
 * popup and the person's choice (`ExtensionSettings.toolbarAction`) decides the click: `ask`
 * leaves the side panel's own click behavior off, so Chrome sends `action.onClicked` and the click
 * shows the in-page ask in the tab, or Atd's panel in the side panel on a tab no content script
 * can run in (`actionClicked`); `panel` turns that behavior on, and Chrome then toggles the side
 * panel on every click itself, without `action.onClicked`. Where a browser has no side panel API,
 * the button's popup is the panel (the same page, opened with `POPUP_SEARCH`) whatever the choice.
 * The popup is set again at every start. Chrome keeps the side panel behavior across sessions, so
 * it is set only from the restored setting and on a change, never reset before the setting is
 * known; a click that wakes the worker therefore follows the person's last choice.
 */

/** The side panel API, where the browser has one: some Chromium browsers leave it out. */
function sidePanelApi(): typeof chrome.sidePanel | undefined {
  return 'sidePanel' in chrome ? chrome.sidePanel : undefined;
}

function popupPage(): string {
  return `${chrome.runtime.getManifest().side_panel?.default_path ?? ''}${POPUP_SEARCH}`;
}

/**
 * Where Atd's panel opens from a surface's own control: the side panel, else the toolbar popup
 * where the browser can open it from code, else nowhere.
 */
export function panelSurface(): PanelSurface | null {
  if (sidePanelApi() !== undefined) return 'sidePanel';
  return typeof chrome.action.openPopup === 'function' ? 'popup' : null;
}

/** Called at every worker start: without a side panel, the button's popup is the panel. */
export function configureActionSurface(): void {
  const popup = sidePanelApi() === undefined ? popupPage() : '';
  chrome.action.setPopup({ popup }).catch((error: unknown) => {
    console.warn('[atd] could not set the toolbar popup', error);
  });
}

/**
 * Applies the toolbar choice where the side panel exists (see the top of this file): with the
 * restored setting at boot, and at once when the person changes it. Without a side panel the
 * choice has no effect.
 */
export function applyToolbarAction(action: ToolbarAction): void {
  const openPanelOnActionClick = action === 'panel';
  sidePanelApi()
    ?.setPanelBehavior({ openPanelOnActionClick })
    .catch((error: unknown) => {
      console.warn('[atd] could not apply the toolbar choice to the side panel', error);
    });
}

/**
 * `action.onClicked`, which Chrome sends only while it does not open the side panel itself. Where
 * the side panel exists, `ask` shows the in-page ask in `tab`, or opens the side panel where no
 * content script reaches it: it decides that from `tab` before it awaits anything, because Chrome
 * opens the side panel only within the click's gesture. A click Chrome hands over while it has not
 * applied the choice `panel` yet opens the side panel, as the choice says. Where a browser has no
 * side panel, the click came before the popup was set, and the panel opens as the popup.
 */
export function actionClicked(
  tab: chrome.tabs.Tab,
  action: ToolbarAction,
  ask: (tab: chrome.tabs.Tab) => void,
): void {
  if (sidePanelApi() === undefined || action === 'panel')
    void openPanel({ windowId: tab.windowId });
  else ask(tab);
}

/** Where `openPanel` opens the panel: in a window, or in the window of a tab. */
export type PanelTarget = { windowId: number } | { tabId: number };

/**
 * Opens Atd's panel: the side panel of the target's window (the global panel, so `tabId` opens it
 * for its whole window), else the toolbar popup. Chrome opens the side panel only in response to
 * the person's action, and the gesture does not survive an `await`, so callers call this before
 * awaiting anything; it calls the API before its own first `await`. Resolves whether it opened.
 */
export async function openPanel(target: PanelTarget): Promise<boolean> {
  const sidePanel = sidePanelApi();
  try {
    if (sidePanel !== undefined) await sidePanel.open(target);
    else await chrome.action.openPopup('windowId' in target ? { windowId: target.windowId } : {});
    return true;
  } catch (error) {
    console.info('[atd] could not open the panel', error);
    return false;
  }
}
