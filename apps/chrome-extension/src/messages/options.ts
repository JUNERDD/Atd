import { Type, type Static } from 'typebox';
import { OriginSchema } from '../channel/payloads.ts';
import { DiagEventMessageSchema } from './diag-event.ts';
import { ToolbarActionSchema } from './settings.ts';
import type { OptionsView } from './views.ts';

/**
 * Options page ↔ service worker, over one `chrome.runtime.connect({name: OPTIONS_PORT})` port per
 * open options page, for as long as it is open. The background pushes `state` on connect and on
 * every change; the page sends intents, which the background validates
 * (`Value.Check(OptionsMessageSchema, …)`) and carries out. The page itself calls no Chrome API
 * that changes anything.
 */
export const OptionsMessageSchema = Type.Union([
  /** The toolbar button's click (`ExtensionSettings.toolbarAction`): kept, then applied at once. */
  Type.Object({ type: Type.Literal('toolbarAction.set'), action: ToolbarActionSchema }),
  /**
   * An allowed website's permission (D6), as the panel's site switch sends it: the page offers
   * only removal. Travels to Atd, whose `sites` frame that follows is the truth.
   */
  Type.Object({ type: Type.Literal('site.set'), origin: OriginSchema, allowed: Type.Boolean() }),
  /**
   * Read the command shortcuts again. Chrome sends no event when the person changes one, so the
   * page asks whenever it may have come back from Chrome's shortcut page (it shows or gains focus).
   */
  Type.Object({ type: Type.Literal('shortcuts.refresh') }),
  /** Change Shortcuts: opens Chrome's own shortcut page (`chrome://extensions/shortcuts`). */
  Type.Object({ type: Type.Literal('shortcuts.edit') }),
  /** Open Atd and Computer Use Settings, as in the panel's More menu: frames to the shell. */
  Type.Object({ type: Type.Literal('app.open') }),
  Type.Object({ type: Type.Literal('settings.open') }),
  /** Options-page runtime or React error-boundary diagnostic. */
  DiagEventMessageSchema,
]);
export type OptionsMessage = Static<typeof OptionsMessageSchema>;

/** Service worker → options page: its view. */
export type BackgroundToOptions = { type: 'state'; view: OptionsView };
