/**
 * The JS↔Swift bridge between the renderer and the macOS shell: the single source of truth, with
 * its calls in `calls.ts`. JS validates every message Swift delivers against these schemas;
 * `scripts/export-bridge-schema.mjs` exports them as JSON Schema (`native-bridge.schema.json`),
 * from which the Swift Codable types are generated. The export script loads these files with Node's
 * type stripping, so they import nothing but TypeBox and each other (by their `.ts` file names) and
 * use only erasable TypeScript syntax. The page's static types derive from these schemas in
 * `client.ts`.
 *
 * Transport: JS posts `JsMessage` values to `window.webkit.messageHandlers[MESSAGE_HANDLER]`; Swift
 * answers and pushes one `SwiftMessage` per `callAsyncJavaScript(DELIVER_SCRIPT)` call, with the
 * message bound to `DELIVER_ARGUMENT`. The delivery function is synchronous.
 */
import { Type, type TSchema } from 'typebox';
import { NativeCalls } from './calls.ts';
import { ImportFailureSchema, NativeFileRefSchema, NativeFolderRefSchema } from './file-calls.ts';
import { Empty, Text } from './primitives.ts';

/** `WKScriptMessageHandler` name the page posts to. */
export const MESSAGE_HANDLER = 'aiNative';
/** The function body Swift runs with `callAsyncJavaScript`, binding `DELIVER_ARGUMENT`. */
export const DELIVER_SCRIPT = 'window.aiNative.deliver(message)';
export const DELIVER_ARGUMENT = 'message';

const DragRectSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
  { additionalProperties: false },
);

/** A rectangle the welcome guide reports, in CSS pixels from the web view's top-left. */
const GuideRectSchema = Type.Object(
  {
    x: Type.Number({ minimum: 0 }),
    y: Type.Number({ minimum: 0 }),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** Longest text `onboarding.selection` takes; the practice area's sample is far shorter. */
export const MAX_PRACTICE_SELECTION_LENGTH = 2000;

/** Posts: JS → Swift one-way messages; Swift sends no reply. */
export const NativePosts = {
  /** The page installed its delivery function; Swift flushes what it queued until now. */
  'bridge.ready': Empty,
  /** The app language, after load and on every change (Swift uses the OS language until then). */
  'language.set': Type.Object(
    { language: Type.Union([Type.Literal('en'), Type.Literal('zh-CN')]) },
    { additionalProperties: false },
  ),
  /**
   * The window drag regions in CSS pixels from the web view's top-left, interactive children
   * already cut out. Sent on every layout change; `[]` on teardown.
   */
  'window.dragRegions': Type.Object(
    { rects: Type.Array(DragRectSchema, { maxItems: 64 }) },
    { additionalProperties: false },
  ),
  /**
   * The welcome guide's glass surface in CSS pixels from the web view's top-left, and its corner
   * radius; the shell lays the window material (the panel's and Settings' glass) under it. The
   * opening page sends its whole box (radius 0); the card takes the glass over by sending its own
   * once its entrance is at rest, then on every resize, and `null` once the guide starts closing
   * and on teardown. `morph` is true only on a surface's first rect after taking the glass over
   * from another surface still holding it: the shown glass then travels to this rect over the
   * hand-off animation (at once under Reduce Motion) instead of moving at once. It is false on
   * every other rect and on `null`, and a rect that finds the glass hidden fades it in in place
   * either way. The shell takes it only from the guide's own web view.
   */
  'onboarding.surface': Type.Object(
    {
      rect: Type.Union([GuideRectSchema, Type.Null()]),
      radius: Type.Number({ minimum: 0 }),
      morph: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  /**
   * The welcome guide's practice selection: the bounding box of text selected in its practice
   * area, in CSS pixels from the web view's top-left, and that text. The shell shows the real
   * selection toolbar beside it (while the toolbar is on and the app is trusted for
   * Accessibility), and its Ask Atd and commands take this text as the selection. `null` hides
   * that toolbar: sent when the selection collapses or leaves the practice text, on a key, a
   * scroll or a step change, once the guide starts closing and on teardown. The shell takes it
   * only from the guide's own web view.
   */
  'onboarding.selection': Type.Object(
    {
      rect: Type.Union([GuideRectSchema, Type.Null()]),
      text: Text(MAX_PRACTICE_SELECTION_LENGTH),
    },
    { additionalProperties: false },
  ),
  /** Opens a virtual socket: Swift connects one real socket to the service for it. */
  'socket.open': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), path: Type.Literal('/v1/stream') },
    { additionalProperties: false },
  ),
  'socket.send': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), data: Type.String() },
    { additionalProperties: false },
  ),
  /**
   * Installs the update `update.state` names and relaunches, through the app's quit flow (which
   * still asks before stopping running tasks). Ignored while no update waits.
   */
  'update.install': Empty,
  'socket.close': Type.Object(
    {
      socketId: Type.String({ minLength: 1, maxLength: 64 }),
      code: Type.Integer({ minimum: 1000, maximum: 4999 }),
      reason: Text(123),
    },
    { additionalProperties: false },
  ),
} satisfies Record<string, TSchema>;

/** One socket frame; Swift batches them per run-loop turn, in order. */
export const SocketFrameSchema = Type.Union([
  Type.Object(
    { socketId: Type.String(), kind: Type.Literal('open') },
    { additionalProperties: false },
  ),
  Type.Object(
    { socketId: Type.String(), kind: Type.Literal('message'), data: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      socketId: Type.String(),
      kind: Type.Literal('close'),
      /** The peer's or the relay's close frame unchanged (1012: the service restarted). */
      code: Type.Integer({ minimum: 1000, maximum: 4999 }),
      reason: Type.String(),
    },
    { additionalProperties: false },
  ),
]);

/** Events: Swift → JS pushes. */
export const NativeEvents = {
  /** The window became or stopped being key; drives the inactive glass dimming. */
  'window.active': Type.Object({ active: Type.Boolean() }, { additionalProperties: false }),
  /** The panel hides at alpha 0 and keeps running, so the page pauses optional work meanwhile. */
  'window.visibility': Type.Object({ visible: Type.Boolean() }, { additionalProperties: false }),
  /**
   * The system's Reduce transparency setting, on load and whenever it changes. WebKit has no
   * `prefers-reduced-transparency`, so glass turns opaque through this instead.
   */
  'accessibility.reduceTransparency': Type.Object(
    { reduce: Type.Boolean() },
    { additionalProperties: false },
  ),
  /** A command shortcut fired; Swift already captured the selection and showed the panel. */
  'shortcut.command': Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false },
  ),
  /**
   * The screenshot shortcut fired; Swift already captured the selection. The panel takes the
   * screenshot itself (`screenshot.capture`), so it can refuse a full draft before the overlay opens.
   */
  'shortcut.screenshot': Empty,
  /**
   * Debug builds' Replay First-Launch Guide (panel only): the page marks the guide as not shown,
   * which runs the first launch's path again.
   */
  'onboarding.replay': Empty,
  /**
   * Swift imported files dropped or pasted into the panel through `/v1/resources/import`, and
   * registered folders through `/v1/folders/register`. `failures` covers both; each path of the
   * import lands in exactly one list.
   */
  'resources.imported': Type.Object(
    {
      resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }),
      folders: Type.Array(NativeFolderRefSchema, { maxItems: 10 }),
      failures: Type.Array(ImportFailureSchema, { maxItems: 20 }),
    },
    { additionalProperties: false },
  ),
  /**
   * The panel's file drop, a state the shell replays: `over` while files are dragged over the
   * panel, `importing` from a drop until its import answered, `none` otherwise. `files` counts the
   * dragged items, folders included; `attachable` counts those of the drop's import (at most 10
   * files and 10 folders) that it would take: files with an attachable format, and folders. Both
   * are 0 outside `over`.
   */
  'files.drag': Type.Object(
    {
      phase: Type.Union([Type.Literal('over'), Type.Literal('importing'), Type.Literal('none')]),
      files: Type.Integer({ minimum: 0 }),
      attachable: Type.Integer({ minimum: 0, maximum: 20 }),
    },
    { additionalProperties: false },
  ),
  /** Edit → Undo/Redo from the shell's menu, sent in place of `undo:`/`redo:` (`edit-commands.ts`). */
  'edit.command': Type.Object(
    { command: Type.Union([Type.Literal('undo'), Type.Literal('redo')]) },
    { additionalProperties: false },
  ),
  /**
   * Whether the shell is reading text aloud (`speech.speak`), sent to every page on each change
   * and replayed when a page becomes ready. It turns false when the speech ends, is stopped or
   * fails; a `speech.speak` that replaces another keeps it true.
   */
  'speech.state': Type.Object({ speaking: Type.Boolean() }, { additionalProperties: false }),
  /**
   * The selection toolbar's Ask Atd fired; Swift already captured the selection and showed the
   * panel. The page takes it (`capture`), inserts it as a quote and focuses the composer.
   */
  'selection.ask': Empty,
  /**
   * Whether the app is trusted for Accessibility (selection capture and the selection toolbar
   * need it), sent to every page on each change and replayed when a page becomes ready.
   */
  'accessibility.trust': Type.Object({ trusted: Type.Boolean() }, { additionalProperties: false }),
  /**
   * Whether this running app may capture the screen (screenshots need Screen Recording), sent to
   * every page on each change and replayed when a page becomes ready. macOS applies a new grant
   * only to a relaunched app, so `trusted` can stay false after the user allows it.
   */
  'screenRecording.trust': Type.Object(
    { trusted: Type.Boolean() },
    { additionalProperties: false },
  ),
  /**
   * The version of a downloaded update that installs when the app quits, null while none waits.
   * Sent to the panel on each change and replayed when its page becomes ready.
   */
  'update.state': Type.Object(
    { version: Type.Union([Text(64), Type.Null()]) },
    { additionalProperties: false },
  ),
  'socket.frames': Type.Object(
    { frames: Type.Array(SocketFrameSchema, { minItems: 1 }) },
    { additionalProperties: false },
  ),
} satisfies Record<string, TSchema>;

const CallId = Type.Integer({ minimum: 1 });

/** Everything JS posts: a call (answered by id) or a one-way post. */
export const JsMessageSchema = Type.Union([
  ...Object.entries(NativeCalls).map(([method, { params }]) =>
    Type.Object(
      { type: Type.Literal('call'), id: CallId, method: Type.Literal(method), params },
      { additionalProperties: false },
    ),
  ),
  ...Object.entries(NativePosts).map(([method, params]) =>
    Type.Object(
      { type: Type.Literal('post'), method: Type.Literal(method), params },
      { additionalProperties: false },
    ),
  ),
]);

/**
 * Everything Swift delivers. A `result` value is checked against its call's `result` schema once
 * JS matched the id; events are checked whole.
 */
export const SwiftMessageSchema = Type.Union([
  Type.Object(
    { type: Type.Literal('result'), id: CallId, value: Type.Unknown() },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('error'), id: CallId, message: Type.String({ maxLength: 2000 }) },
    { additionalProperties: false },
  ),
  ...Object.entries(NativeEvents).map(([event, payload]) =>
    Type.Object(
      { type: Type.Literal('event'), event: Type.Literal(event), payload },
      { additionalProperties: false },
    ),
  ),
]);
