import { Type, type Static } from 'typebox';
import type { PopupView } from './views.ts';

/**
 * Toolbar popup ↔ service worker, over one `chrome.runtime.connect({name: POPUP_PORT})` port that
 * lives as long as the popup. The background pushes `state` on connect and on every change; the
 * popup sends intents and reads the active tab itself (`chrome.tabs.query`). The background
 * validates every message (`Value.Check(PopupMessageSchema, …)`).
 */

const Id = Type.String({ minLength: 1, maxLength: 256 });
const TabId = Type.Integer({ minimum: 0 });

export const PopupMessageSchema = Type.Union([
  /** Connect…: generate a code and ask Atd to pair (`pair.request`). */
  Type.Object({ type: Type.Literal('pair.start') }),
  Type.Object({ type: Type.Literal('pair.cancel') }),
  /** Reconnect now instead of waiting for the next backoff attempt. */
  Type.Object({ type: Type.Literal('reconnect') }),
  /** "Ask Atd on This Page…": open the in-page ask in that tab (the popup then closes itself). */
  Type.Object({ type: Type.Literal('ask.open'), tabId: TabId }),
  Type.Object({
    type: Type.Literal('site.set'),
    origin: Type.String({ minLength: 1, maxLength: 2048 }),
    allowed: Type.Boolean(),
  }),
  Type.Object({ type: Type.Literal('run.stop'), taskId: Id, runId: Id }),
  /** Show Tab: focus the tab (and its window) a run works in. */
  Type.Object({ type: Type.Literal('tab.show'), tabId: TabId }),
  Type.Object({ type: Type.Literal('app.open'), taskId: Type.Optional(Id) }),
  Type.Object({ type: Type.Literal('settings.open') }),
]);
export type PopupMessage = Static<typeof PopupMessageSchema>;

/** Service worker → popup. */
export type BackgroundToPopup = { type: 'state'; view: PopupView };
