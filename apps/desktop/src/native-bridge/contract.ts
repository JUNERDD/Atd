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
import { Empty, NativeCalls, NativeFileRefSchema, Text } from './calls.ts';

/** `WKScriptMessageHandler` name the page posts to. */
export const MESSAGE_HANDLER = 'aiNative';
/** The function body Swift runs with `callAsyncJavaScript`, binding `DELIVER_ARGUMENT`. */
export const DELIVER_SCRIPT = 'window.aiNative.deliver(message)';
export const DELIVER_ARGUMENT = 'message';

/** A path the import refused: the file's basename (the page never sees paths) and the reason. */
const ImportFailureSchema = Type.Object(
  {
    name: Text(255),
    reason: Type.Union([
      Type.Literal('unreadable'),
      Type.Literal('unsupported'),
      Type.Literal('tooLarge'),
    ]),
  },
  { additionalProperties: false },
);

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
  /** Swift imported files dropped or pasted into the panel through `/v1/resources/import`. */
  'resources.imported': Type.Object(
    {
      resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }),
      failures: Type.Array(ImportFailureSchema, { maxItems: 10 }),
    },
    { additionalProperties: false },
  ),
  /** Edit → Undo/Redo from the shell's menu, sent in place of `undo:`/`redo:` (`edit-commands.ts`). */
  'edit.command': Type.Object(
    { command: Type.Union([Type.Literal('undo'), Type.Literal('redo')]) },
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
