import { PermissionAnswerSchema } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { OwnInputSchema, PickedElementSchema } from '../channel/payloads.ts';
import type { AskStatus, PointerView, TabView } from './views.ts';

/**
 * Content script ↔ service worker, over one `chrome.runtime.connect({name: CONTENT_PORT})` port
 * per tab (top frame only). The content script reconnects when the port drops (the service worker
 * restarted) and sends `ready`; the background answers with the tab's `state` and pushes every
 * change after that. The background knows the tab from the port's sender and adds the tab's id,
 * URL and title to the frames it forwards, so the content script never reports them.
 *
 * The background validates every message (`Value.Check(ContentMessageSchema, …)`): a page cannot
 * script an isolated world, but a compromised renderer can send anything. The content script
 * imports this file with `import type` only.
 */

const Id = Type.String({ minLength: 1, maxLength: 256 });
/**
 * The longest request text a tab may send, in code points (TypeBox's `maxLength`): the service's
 * task input limit. The background refuses a longer one with `tooLong`.
 */
export const MAX_REQUEST_TEXT = 100_000;

export const ContentMessageSchema = Type.Union([
  /** Sent on every (re)connect; answered by `state`. */
  Type.Object({ type: Type.Literal('ready') }),
  /**
   * The in-page ask was sent. `includePage: false` (the person removed the page chip) sends the
   * request without the page's URL and title. `elements`: the elements the person picked on the
   * page (the inspector), built when each was picked; they go to Atd only with the page.
   */
  Type.Object({
    type: Type.Literal('ask'),
    requestId: Id,
    text: Type.String({ minLength: 1, maxLength: MAX_REQUEST_TEXT }),
    includePage: Type.Boolean(),
    elements: Type.Optional(Type.Array(PickedElementSchema, { minItems: 1, maxItems: 5 })),
    ownInput: Type.Optional(OwnInputSchema),
  }),
  /**
   * Open side panel in the in-page ask: Atd's panel for this tab's window (the toolbar popup where
   * a browser has no side panel), answered by `panel.status`. Sent within the person's click: the
   * port message carries the frame's user activation to the worker, which holds it only while it
   * dispatches the message, so the worker opens the panel before it awaits anything.
   */
  Type.Object({ type: Type.Literal('panel.open') }),
  Type.Object({ type: Type.Literal('run.stop'), taskId: Id, runId: Id }),
  /**
   * Dismiss on an ended run's HUD: the shell may forget the run (`run.dismiss`), and the tab no
   * longer shows it, also after a reload.
   */
  Type.Object({ type: Type.Literal('run.dismiss'), taskId: Id, runId: Id }),
  /**
   * An ended run's HUD hid on its own (Done without a reply, Stopped). The shell is not told; the
   * tab no longer shows the run, also after a reload.
   */
  Type.Object({ type: Type.Literal('run.hide'), taskId: Id, runId: Id }),
  /** Take over (`held: true`) or Hand back (`held: false`) this tab. */
  Type.Object({
    type: Type.Literal('run.hold'),
    taskId: Id,
    runId: Id,
    held: Type.Boolean(),
    ownInput: Type.Optional(OwnInputSchema),
  }),
  Type.Object({
    type: Type.Literal('request.answer'),
    taskId: Id,
    requestId: Id,
    revision: Type.Integer({ minimum: 0 }),
    answer: PermissionAnswerSchema,
    ownInput: Type.Optional(OwnInputSchema),
  }),
  /** Done → Save as automation: Atd is asked to turn the run into an automation ("Sent to Atd"). */
  Type.Object({
    type: Type.Literal('run.followUp'),
    taskId: Id,
    kind: Type.Literal('saveAutomation'),
  }),
  /** Open in Atd / Continue in Atd (the task when known, else the app). */
  Type.Object({ type: Type.Literal('app.open'), taskId: Type.Optional(Id) }),
  /**
   * The person used the page (pointer or key, throttled to one message a second). The background
   * reports it as `lastInputAt` for tabs a run owns and ignores it otherwise.
   */
  Type.Object({ type: Type.Literal('input') }),
  /**
   * A page transition is about to play: capture the tab's visible area for it (answered by
   * `transition.frame` with the same id). `hold` (the takeover's ripple) holds the agent's
   * screenshots and input to this tab, and every command after them, until `transition.end`
   * (2.5 s at most), so its first look and its first click never meet the bent page.
   */
  Type.Object({ type: Type.Literal('transition.capture'), requestId: Id, hold: Type.Boolean() }),
  /** The transition `requestId` has left the page (or never played): its hold ends. */
  Type.Object({ type: Type.Literal('transition.end'), requestId: Id }),
]);
export type ContentMessage = Static<typeof ContentMessageSchema>;

/** Service worker → content script. */
export type BackgroundToContent =
  | { type: 'state'; view: TabView }
  /** `null` hides the pointer (`cleared`, run end, tab released). */
  | { type: 'pointer'; pointer: PointerView | null }
  /** The toolbar button or the ask shortcut (⇧⌘K by default): open the in-page ask, or close it. */
  | { type: 'ask.open' }
  /** The answer to `panel.open`: whether Atd's panel opened (Chrome may refuse it). */
  | { type: 'panel.status'; opened: boolean }
  /** Atd's answer to the tab's ask; the run it started then shows in `state.view.run`. */
  | AskStatus
  /**
   * Save as automation did not reach Atd (the shell answered `error {ref: taskId}`, or the
   * channel was not ready): the HUD shows the failure instead of "Sent to Atd".
   */
  | { type: 'followUp.failed'; taskId: string }
  /**
   * The answer to `transition.capture`: the tab's visible area as base64 JPEG at device pixels
   * (its pixel size is the decoded image's), or `null` when it could not be captured for this
   * document (the tab was not the active one of its window, before or after the capture; the
   * capture rate was spent; no run is in the tab).
   */
  | { type: 'transition.frame'; requestId: string; jpeg: string | null };
