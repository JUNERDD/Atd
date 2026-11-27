import { Type, type Static } from 'typebox';
import { OwnInputSchema } from '../channel/payloads.ts';
import { MAX_REQUEST_TEXT } from './content.ts';
import type { AskStatus, PanelView } from './views.ts';

/**
 * Panel ↔ service worker, over one `chrome.runtime.connect({name: PANEL_PORT})` port per open
 * panel (Chrome's side panel of a window, or the toolbar popup where a browser has none), for as
 * long as it is open. The background pushes `state` on connect and on every change; the panel
 * sends intents and follows its window's active tab itself (`chrome.tabs`). The background
 * validates every message (`Value.Check(PanelMessageSchema, …)`).
 */

const Id = Type.String({ minLength: 1, maxLength: 256 });
const TabId = Type.Integer({ minimum: 0 });

export const PanelMessageSchema = Type.Union([
  /** Connect…: generate a code and ask Atd to pair (`pair.request`). */
  Type.Object({ type: Type.Literal('pair.start') }),
  Type.Object({ type: Type.Literal('pair.cancel') }),
  /** Reconnect now instead of waiting for the next backoff attempt. */
  Type.Object({ type: Type.Literal('reconnect') }),
  /**
   * The panel's composer was sent, from the tab its window shows. `includePage: false` (the person
   * removed the page chip, or the tab is no website) sends the request without the tab's URL and
   * title. Answered by `ask.status` with the same id, on the same port.
   */
  Type.Object({
    type: Type.Literal('ask'),
    requestId: Id,
    tabId: TabId,
    text: Type.String({ minLength: 1, maxLength: MAX_REQUEST_TEXT }),
    includePage: Type.Boolean(),
    ownInput: Type.Optional(OwnInputSchema),
  }),
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
  /** Extension Settings…: the extension's own options page, in a tab. */
  Type.Object({ type: Type.Literal('options.open') }),
]);
export type PanelMessage = Static<typeof PanelMessageSchema>;

/** Service worker → panel: its view, and Atd's answer to the panel's own ask. */
export type BackgroundToPanel = { type: 'state'; view: PanelView } | AskStatus;
