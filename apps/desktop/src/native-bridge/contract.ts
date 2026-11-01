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
import { NativeOnboardingPosts } from './onboarding-posts.ts';
import { NativeCalls } from './calls.ts';
import { NativeDiagnosticPosts } from './diagnostic-calls.ts';
import {
  CommandArgumentsSchema,
  NativeCommandOptionsEvents,
  ShortcutCommandIntentSchema,
} from './command-options.ts';
import { NativeComputerEvents } from './computer-calls.ts';
import { ImportFailureSchema, NativeFileRefSchema, NativeFolderRefSchema } from './file-calls.ts';
import { NativeNotificationPosts } from './notification-calls.ts';
import { Empty, Text } from './primitives.ts';
import { NativePreferencePosts } from './preference-posts.ts';
import { NativeShortcutRecordingEvents } from './shortcut-recording.ts';
import { NativeTaskEvents } from './task-events.ts';
import { NativeTextEvents, NativeTextPosts, NativeWriteTargetSchema } from './text-calls.ts';
import { NativeUpdateEvents, NativeUpdatePosts } from './update-calls.ts';
import { UserAppIdSchema } from './user-app-contract.ts';
import {
  DesktopPinSchema,
  MAX_DESKTOP_PINS,
  MiniPanelOpenOnSchema,
  PinWidgetSchema,
} from './window-calls.ts';

/** `WKScriptMessageHandler` name the page posts to. */
export const MESSAGE_HANDLER = 'aiNative';
/** The function body Swift runs with `callAsyncJavaScript`, binding `DELIVER_ARGUMENT`. */
export const DELIVER_SCRIPT = 'window.aiNative.deliver(message)';
export const DELIVER_ARGUMENT = 'message';

const DragRectSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
  { additionalProperties: false },
);

export { MAX_PRACTICE_SELECTION_LENGTH } from './onboarding-posts.ts';

/** Posts: JS → Swift one-way messages; Swift sends no reply. */
export const NativePosts = {
  ...NativeDiagnosticPosts,
  /** The page installed its delivery function; Swift flushes what it queued until now. */
  'bridge.ready': Empty,
  ...NativePreferencePosts,
  ...NativeTextPosts,
  /**
   * The window drag regions in CSS pixels from the web view's top-left, interactive children
   * already cut out. Sent on every layout change; `[]` on teardown.
   */
  'window.dragRegions': Type.Object(
    { rects: Type.Array(DragRectSchema, { maxItems: 64 }) },
    { additionalProperties: false },
  ),
  ...NativeOnboardingPosts,
  /** Opens a virtual socket: Swift connects one real socket to the service for it. */
  'socket.open': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), path: Type.Literal('/v1/stream') },
    { additionalProperties: false },
  ),
  'socket.send': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), data: Type.String() },
    { additionalProperties: false },
  ),
  ...NativeUpdatePosts,
  ...NativeNotificationPosts,
  'socket.close': Type.Object(
    {
      socketId: Type.String({ minLength: 1, maxLength: 64 }),
      code: Type.Integer({ minimum: 1000, maximum: 4999 }),
      reason: Text(123),
    },
    { additionalProperties: false },
  ),
  /**
   * Drags the app's pin out of the page: posted once a press on the app's card, or on one of its
   * widget previews, moved past the drag threshold, with the button still down. The shell starts
   * a native drag from that press with the pin as its image; a drop on the desktop pins the app
   * there or moves its pin, and Escape or a drop anywhere else ends it without a change. `widget`
   * is what the pin shows, as for `userApp.pin` (an undeclared one ends the drag before it
   * starts); null keeps what a pinned app shows and gives a new pin the app's default. The shell
   * takes it only from the panel and the settings window, while the left button is down after a
   * press under two seconds old.
   */
  'userApp.pinDrag': Type.Object(
    { appId: UserAppIdSchema, widget: Type.Union([PinWidgetSchema, Type.Null()]) },
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
  /**
   * A command shortcut or selection toolbar command fired; Swift already captured the selection.
   * `id`: the registration id of a command shortcut (`CommandShortcut.id`), which the page maps to
   * its command and launches with that shortcut's settings, or a command id (the selection
   * toolbar and the mini panel), which launches the command with its own.
   * `target`: the text field focused in the app the command ran from (absent when none was found,
   * Accessibility is off, or the panel had the focus), which `text.write` can write the answer into.
   * `arguments`: values picked in the shell's options, over the remembered ones; `intent`: what to
   * do with the command (`ShortcutCommandIntentSchema`, absent: `run`).
   */
  'shortcut.command': Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 128 }),
      target: Type.Optional(NativeWriteTargetSchema),
      arguments: Type.Optional(CommandArgumentsSchema),
      intent: Type.Optional(ShortcutCommandIntentSchema),
    },
    { additionalProperties: false },
  ),
  /**
   * The screenshot shortcut fired; Swift already captured the selection. The panel takes the
   * screenshot itself (`screenshot.capture`), so it can refuse a full draft before the overlay opens.
   */
  'shortcut.screenshot': Empty,
  /**
   * Swift imported the files of one gesture (a drop, a paste, the Finder service) through
   * `/v1/resources/import` and registered its folders through `/v1/folders/register`. Every item
   * lands in exactly one list: a failed request's items and those past the gesture's limits are
   * `failed` and `tooMany` failures, so `failures` has no fixed bound.
   */
  'resources.imported': Type.Object(
    {
      resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }),
      folders: Type.Array(NativeFolderRefSchema, { maxItems: 10 }),
      failures: Type.Array(ImportFailureSchema),
    },
    { additionalProperties: false },
  ),
  /**
   * The panel's file drop, a state the shell replays: `over` while files are dragged over the
   * panel, `importing` from a drop until its import answered, `none` otherwise. `files` counts the
   * dragged items (folders, promised files and a bitmap included); `attachable` those the drop's
   * import would take: its first 10 files, of any format, and its first 10 folders. The shell
   * reports only a drag that carries one, so `attachable` is at least 1 during `over`; the service
   * may still refuse a file after the drop. Both are 0 outside `over`.
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
   * The mini panel's New task: Swift already showed the panel. The page leaves the open task for a
   * new task's composer, as the panel's own New task button does.
   */
  'task.new': Empty,
  /**
   * Whether the mini panel shows on the screen edge (`miniPanel.setShown`, the menu bar's toggle
   * and the mini panel's own Hide) and how it opens (`miniPanel.setOpenOn` and its context menu),
   * sent to every page on each change and replayed when a page becomes ready.
   */
  'miniPanel.state': Type.Object(
    { shown: Type.Boolean(), openOn: MiniPanelOpenOnSchema },
    { additionalProperties: false },
  ),
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
  ...NativeUpdateEvents,
  ...NativeComputerEvents,
  ...NativeShortcutRecordingEvents,
  'socket.frames': Type.Object(
    { frames: Type.Array(SocketFrameSchema, { minItems: 1 }) },
    { additionalProperties: false },
  ),
  /**
   * A user app window opened, reloaded or closed: `version` is the version it loaded, null once
   * closed. Sent to every page on each change and replayed for each open window when a page
   * becomes ready, so the renderer knows which open apps to reload after an `apps` invalidate.
   */
  'userApp.state': Type.Object(
    {
      appId: UserAppIdSchema,
      open: Type.Boolean(),
      version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    },
    { additionalProperties: false },
  ),
  /**
   * The apps pinned to the desktop and what each pin shows, oldest pin first: the whole list, sent
   * to every page on each change and replayed when a page becomes ready, including a settings
   * window opened later.
   */
  'userApp.pins': Type.Object(
    { pins: Type.Array(DesktopPinSchema, { maxItems: MAX_DESKTOP_PINS }) },
    { additionalProperties: false },
  ),
  ...NativeTaskEvents,
  ...NativeTextEvents,
  ...NativeCommandOptionsEvents,
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
