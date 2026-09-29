/**
 * The JS↔Swift bridge between the renderer and the macOS shell: the single source of truth. JS
 * validates every message Swift delivers against these schemas; `scripts/export-bridge-schema.mjs`
 * exports them as JSON Schema (`native-bridge.schema.json`), from which the Swift Codable types are
 * generated. The export script loads this file with Node's type stripping, so it imports nothing
 * but TypeBox and uses only erasable TypeScript syntax.
 *
 * Transport: JS posts `JsMessage` values to `window.webkit.messageHandlers[MESSAGE_HANDLER]`; Swift
 * answers and pushes one `SwiftMessage` per `callAsyncJavaScript(DELIVER_SCRIPT)` call, with the
 * message bound to `DELIVER_ARGUMENT`. The delivery function is synchronous.
 */
import { Type, type Static, type TSchema } from 'typebox';

/** `WKScriptMessageHandler` name the page posts to. */
export const MESSAGE_HANDLER = 'aiNative';
/** The function body Swift runs with `callAsyncJavaScript`, binding `DELIVER_ARGUMENT`. */
export const DELIVER_SCRIPT = 'window.aiNative.deliver(message)';
export const DELIVER_ARGUMENT = 'message';

const Empty = Type.Object({}, { additionalProperties: false });
const Text = (maxLength: number) => Type.String({ maxLength });
/**
 * Mirrors `FileRefSchema` (`electron/agent/task-schema.ts`); the WebView host returns it where a
 * `FileRef` is expected, so type checking catches a drift.
 */
export const NativeFileRefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    name: Text(255),
    size: Type.Integer({ minimum: 0 }),
    type: Text(100),
  },
  { additionalProperties: false },
);
const Resources = Type.Object(
  { resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }) },
  { additionalProperties: false },
);

/** The id of the panel toggle registration; every other shortcut registration is a command id. */
export const PANEL_SHORTCUT_ID = 'togglePanel';

export const ShortcutRegistrationSchema = Type.Object(
  {
    /** `togglePanel`, or the id of the command the shortcut launches. */
    id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    /** Electron accelerator grammar (`CommandOrControl+Shift+Space`), converted by Swift. */
    accelerator: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);

export const ShortcutResultSchema = Type.Union([
  Type.Object(
    { id: Type.String(), registered: Type.Literal(true) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: Type.String(),
      registered: Type.Literal(false),
      /** `unavailable`: the OS or another app holds it; `invalid`: Swift cannot express it. */
      reason: Type.Union([Type.Literal('unavailable'), Type.Literal('invalid')]),
    },
    { additionalProperties: false },
  ),
]);

/** Input text limit shared with clipboard capture and the service's command input. */
export const MAX_CAPTURE_LENGTH = 100000;

/**
 * Calls: JS → Swift requests that Swift answers with a `result` carrying `result`, or an `error`
 * whose message the page shows as is.
 */
export const NativeCalls = {
  /** Shows and focuses the panel. */
  'window.show': { params: Empty, result: Empty },
  /** Hides the panel (alpha 0; it stays ordered in). */
  'window.hide': { params: Empty, result: Empty },
  'window.setPinned': {
    params: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Window and app preferences the shell owns; `openAtLogin` is null where unsupported. */
  'app.state': {
    params: Empty,
    result: Type.Object(
      {
        pinned: Type.Boolean(),
        showInDock: Type.Boolean(),
        openAtLogin: Type.Union([Type.Boolean(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  'app.setShowInDock': {
    params: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Resolves to the applied state, false while macOS waits for approval in System Settings. */
  'app.setOpenAtLogin': {
    params: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Shows the settings window; a first load opens `commandId`'s editor when it is set. */
  'settings.open': {
    params: Type.Object(
      { commandId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  'settings.close': { params: Empty, result: Empty },
  /**
   * Replaces the whole set of global shortcuts. Swift registers the difference and reports every
   * item. `selectionWanted`: an enabled command reads the selection, so each summon that shows the
   * panel captures the selection first (otherwise the stash is cleared).
   */
  'shortcuts.set': {
    params: Type.Object(
      {
        registrations: Type.Array(ShortcutRegistrationSchema, { maxItems: 256 }),
        selectionWanted: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Type.Object(
      { results: Type.Array(ShortcutResultSchema, { maxItems: 256 }) },
      { additionalProperties: false },
    ),
  },
  /** Takes the selection Swift stashed at the last summon (never a live read). */
  capture: {
    params: Type.Object({ source: Type.Literal('selection') }, { additionalProperties: false }),
    result: Type.Union([
      Type.Object(
        {
          ok: Type.Literal(true),
          text: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
          capturedAt: Type.String({ maxLength: 64 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ok: Type.Literal(false),
          /** Not trusted for Accessibility, nothing selected, or over `MAX_CAPTURE_LENGTH`. */
          reason: Type.Union([
            Type.Literal('notTrusted'),
            Type.Literal('noSelection'),
            Type.Literal('tooLong'),
          ]),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  'clipboard.read': {
    params: Empty,
    result: Type.Object({ text: Type.String() }, { additionalProperties: false }),
  },
  'clipboard.write': {
    params: Type.Object({ text: Text(1000000) }, { additionalProperties: false }),
    result: Empty,
  },
  /** Opens an http(s) link in the default browser; Swift checks the scheme again. */
  'link.open': {
    params: Type.Object(
      { url: Type.String({ maxLength: 8192, pattern: '^https?://' }) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /** Downloads the artifact through the service, then opens, reveals, or copies its path. */
  artifact: {
    params: Type.Object(
      {
        artifactId: Type.String({ minLength: 1, maxLength: 128 }),
        operation: Type.Union([
          Type.Literal('open'),
          Type.Literal('reveal'),
          Type.Literal('copyPath'),
        ]),
      },
      { additionalProperties: false },
    ),
    result: NativeFileRefSchema,
  },
  /** Open panel for attachments, imported through `/v1/resources/import`; `[]` when cancelled. */
  'files.pick': { params: Empty, result: Resources },
  /** Save panel for a service resource; `saved` is false when cancelled. */
  'files.save': {
    params: Type.Object(
      { resourceId: Type.String({ minLength: 1, maxLength: 128 }), name: Text(255) },
      { additionalProperties: false },
    ),
    result: Type.Object({ saved: Type.Boolean() }, { additionalProperties: false }),
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;

const DragRectSchema = Type.Object(
  { x: Type.Number(), y: Type.Number(), width: Type.Number(), height: Type.Number() },
  { additionalProperties: false },
);

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
  /** Opens a virtual socket: Swift connects one real socket to the service for it. */
  'socket.open': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), path: Type.Literal('/v1/stream') },
    { additionalProperties: false },
  ),
  'socket.send': Type.Object(
    { socketId: Type.String({ minLength: 1, maxLength: 64 }), data: Type.String() },
    { additionalProperties: false },
  ),
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
  /** A command shortcut fired; Swift already captured the selection and showed the panel. */
  'shortcut.command': Type.Object(
    { id: Type.String({ minLength: 1, maxLength: 128 }) },
    { additionalProperties: false },
  ),
  /** Swift imported dropped or pasted files through `/v1/resources/import`. */
  'resources.imported': Resources,
  'socket.frames': Type.Object(
    { frames: Type.Array(SocketFrameSchema, { minItems: 1 }) },
    { additionalProperties: false },
  ),
} satisfies Record<string, TSchema>;

export type NativeCallName = keyof typeof NativeCalls;
export type NativePostName = keyof typeof NativePosts;
export type NativeEventName = keyof typeof NativeEvents;
export type CallParams<M extends NativeCallName> = Static<(typeof NativeCalls)[M]['params']>;
export type CallResult<M extends NativeCallName> = Static<(typeof NativeCalls)[M]['result']>;
export type PostParams<P extends NativePostName> = Static<(typeof NativePosts)[P]>;
export type EventPayload<E extends NativeEventName> = Static<(typeof NativeEvents)[E]>;
export type SocketFrame = Static<typeof SocketFrameSchema>;
export type ShortcutResult = Static<typeof ShortcutResultSchema>;

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
export type SwiftMessage = Static<typeof SwiftMessageSchema>;
