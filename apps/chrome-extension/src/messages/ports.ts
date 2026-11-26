/** `chrome.runtime.connect` port names; the background tells its surfaces apart by them. */
export const CONTENT_PORT = 'atd.content';
export const PANEL_PORT = 'atd.panel';

/**
 * The query the panel page is opened with as the toolbar popup, where a browser has no side panel
 * (`background/action-surface.ts`); without it, the page is the side panel.
 */
export const POPUP_SEARCH = '?surface=popup';

/** `chrome.storage.local` keys shared across contexts. */
export const STORAGE_KEYS = {
  /** `{installationId}` (background). */
  installation: 'atd.installation',
  /** `{secret, label}` once paired (background). */
  pairing: 'atd.pairing',
  /** Last prefs from Atd, so surfaces start in the right language while disconnected. */
  prefs: 'atd.prefs',
  /** Prefix of the HUD's remembered anchor per site: `atd.hud.<origin>` (content script). */
  hudPosition: 'atd.hud.',
} as const;
