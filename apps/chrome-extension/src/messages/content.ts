import { PermissionAnswerSchema } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import type { AskFailure, PointerView, TabView } from './views.ts';

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
   * request without the page's URL and title.
   */
  Type.Object({
    type: Type.Literal('ask'),
    requestId: Id,
    text: Type.String({ minLength: 1, maxLength: MAX_REQUEST_TEXT }),
    includePage: Type.Boolean(),
  }),
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
  Type.Object({ type: Type.Literal('run.hold'), taskId: Id, runId: Id, held: Type.Boolean() }),
  Type.Object({
    type: Type.Literal('request.answer'),
    taskId: Id,
    requestId: Id,
    revision: Type.Integer({ minimum: 0 }),
    answer: PermissionAnswerSchema,
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
]);
export type ContentMessage = Static<typeof ContentMessageSchema>;

/** Service worker → content script. */
export type BackgroundToContent =
  | { type: 'state'; view: TabView }
  /** `null` hides the pointer (`cleared`, run end, tab released). */
  | { type: 'pointer'; pointer: PointerView | null }
  /** The ask shortcut (⇧⌘K by default) or the popup's "Ask Atd on This Page…" opens the ask. */
  | { type: 'ask.open' }
  /**
   * Atd took the ask (`taskId`/`runId` name the run it started, which then shows in
   * `state.view.run`) or refused it (`reason`).
   */
  | {
      type: 'ask.status';
      requestId: string;
      state: 'accepted' | 'failed';
      reason?: AskFailure;
      taskId?: string;
      runId?: string;
    }
  /**
   * Save as automation did not reach Atd (the shell answered `error {ref: taskId}`, or the
   * channel was not ready): the HUD shows the failure instead of "Sent to Atd".
   */
  | { type: 'followUp.failed'; taskId: string };
