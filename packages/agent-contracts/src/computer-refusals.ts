import { Type, type Static } from 'typebox';
import type { ComputerErrorCode } from './computer-results.js';

/**
 * Why a host refused a step and what changed around an action
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §3, §4.2–§4.3;
 * docs/plans/2026-10-21-foreground-fallback.md). A refusal names the limit the host hit when no
 * delivery the request allows could take the step (the foreground only where
 * `ExecutionEnvelope.foregroundAllowed` lets it, and never past the limits it does not lift), so a
 * person can do that step themselves; a disturbance is a fact the host's guard measured.
 * `computer-results.ts` carries both on its errors and results.
 */

/**
 * Which limit stopped a request (`ComputerError.reason`), mostly with `noBackgroundRoute`, and
 * with `targetUnavailable` for a window the host cannot read.
 * - `dragAndDrop`: the step needs a native drag-and-drop session; only drags inside the target's
 *   content have a background route, and one across apps or out of the window needs the real
 *   pointer, which the host never moves.
 * - `hover`: the step needs the real pointer to hover (hover effects, tooltips), which the host
 *   never moves.
 * - `opaqueSurface`: the target draws an opaque surface (Metal, OpenGL, a game) with no
 *   accessibility tree to act on; posted input misses it in the foreground too.
 * - `pointerToolkit`: the target's toolkit reads the real pointer position (Java, Tk and the like),
 *   so input posted to the window misses, in the foreground too.
 * - `secureInput`: secure text entry is on, which takes no posted input.
 * - `menuUnavailable`: the menu item is missing or cannot be pressed while the app is in the
 *   background.
 * - `textUnavailable`: no route can write the text (no settable value, no key route here).
 * - `keyUnavailable`: the key or shortcut has no route (no matching menu item, no key route here).
 *   For both, the foreground does not help an app of the Chromium family, which takes no posted
 *   keys in front or not, and when an input method is the keyboard input source the host refuses
 *   with the same code and reason and names the method in the message.
 * - `minimized`, `offSpace`, `fullScreen`: the window is minimized, on another Space (or on one the
 *   host cannot tell) or in a full-screen Space; the host never restores, moves or switches to it,
 *   though a window on another Space can still be read.
 * - `noRoute`: every route for the step was ruled out before anything was sent, for no reason
 *   above.
 * - `openBrowser`: the managed browser could not be started in the background (the browser is
 *   missing, or it never answered); the person opens it.
 * - `screenLocked`: the Mac is locked or its session is not on the console; macOS hides app windows
 *   from accessibility and drops posted input until the person unlocks it (browser targets keep
 *   working).
 * - `covered`: the step needed the foreground, and once the target app and window were in front,
 *   another window (Atd's own panel included) still covered the point the step acts on; the host
 *   sent nothing and restored what the person had in front of them.
 * - `notActivated`: the step needed the foreground, but the host could not make the target app
 *   active with the target window frontmost; it sent nothing and restored what it changed.
 */
export const ComputerRefusalReasonSchema = Type.Union([
  Type.Literal('dragAndDrop'),
  Type.Literal('hover'),
  Type.Literal('opaqueSurface'),
  Type.Literal('pointerToolkit'),
  Type.Literal('secureInput'),
  Type.Literal('menuUnavailable'),
  Type.Literal('textUnavailable'),
  Type.Literal('keyUnavailable'),
  Type.Literal('minimized'),
  Type.Literal('offSpace'),
  Type.Literal('fullScreen'),
  Type.Literal('noRoute'),
  Type.Literal('openBrowser'),
  Type.Literal('screenLocked'),
  Type.Literal('covered'),
  Type.Literal('notActivated'),
]);
export type ComputerRefusalReason = Static<typeof ComputerRefusalReasonSchema>;

/** Disturbances one action result lists (`ActionResult.disturbances`). */
export const COMPUTER_MAX_DISTURBANCES = 8;

/**
 * One disturbance the host's guard measured around an action, in the eight kinds of the Cua Bench
 * v2 taxonomy: `keyFocus` the person's key window lost focus; `raise` a window was raised over
 * the person's; `pointer` the real pointer moved; `clipboard` the clipboard changed; `space` the
 * active Space changed; `dialog` a sheet or dialog appeared on the person's app; `activation` the
 * person's app was activated or deactivated; `input` the person's input was lost or redirected.
 * `attribution` says who caused it as far as the host can tell: `agent` on the driver's own
 * evidence, `person` on the person's own input, `unknown` when both overlapped or nothing says.
 * `repaired` says whether the host restored what changed. An `agent` disturbance ends its action
 * `disturbed`, except a `raise` or `activation` one that a background route caused in a request
 * that allows the foreground and that the host repaired by restoring the person's front app and
 * key window: that action goes on without an error and lists it `repaired`, while the route still
 * goes off. That restore never moves the pointer, so a `pointer` disturbance is never repaired
 * this way. A foreground step's own expected activation and raise are no disturbance once
 * restored; one it could not restore is an unrepaired `agent` disturbance that switches no route
 * off. `detail` is a short note for logs and people.
 */
export const ComputerDisturbanceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('keyFocus'),
      Type.Literal('raise'),
      Type.Literal('pointer'),
      Type.Literal('clipboard'),
      Type.Literal('space'),
      Type.Literal('dialog'),
      Type.Literal('activation'),
      Type.Literal('input'),
    ]),
    attribution: Type.Union([
      Type.Literal('agent'),
      Type.Literal('person'),
      Type.Literal('unknown'),
    ]),
    repaired: Type.Boolean(),
    detail: Type.Optional(Type.String({ maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type ComputerDisturbance = Static<typeof ComputerDisturbanceSchema>;

/**
 * Error codes computer protocol 8 retired, with the current code a record written before it reads
 * as: `needsForeground` becomes `noBackgroundRoute` (nothing asks for the foreground),
 * `userTookOver` becomes `targetInUse` (the person was using the target) and `paused` becomes
 * `cancelled` (no foreground control is left to pause). Nothing writes these codes any more; only
 * readers of stored records (facts, journals, ledgers) map them, through
 * `currentComputerErrorCode`, so an unresolved action stays unresolved instead of failing to load.
 */
export const RETIRED_COMPUTER_ERROR_CODES = Object.freeze({
  needsForeground: 'noBackgroundRoute',
  userTookOver: 'targetInUse',
  paused: 'cancelled',
} as const satisfies Record<string, ComputerErrorCode>);
type RetiredComputerErrorCode = keyof typeof RETIRED_COMPUTER_ERROR_CODES;

function isRetiredComputerErrorCode(code: string): code is RetiredComputerErrorCode {
  return Object.hasOwn(RETIRED_COMPUTER_ERROR_CODES, code);
}

/**
 * The code a stored error code reads as today: a retired code maps to its replacement
 * (`RETIRED_COMPUTER_ERROR_CODES`); any other value comes back unchanged for the reader's own
 * schema check, which still refuses a code that never existed.
 */
export function currentComputerErrorCode(code: string): string {
  return isRetiredComputerErrorCode(code) ? RETIRED_COMPUTER_ERROR_CODES[code] : code;
}
