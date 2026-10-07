import { Type, type Static, type TSchema } from 'typebox';
import { AppApiNameSchema, AppErrorSchema } from './app-identity.js';
import {
  AgentRunInputSchema,
  AiGenerateInputSchema,
  McpCallToolInputSchema,
  McpListToolsInputSchema,
  MemoryReadInputSchema,
  MemorySearchInputSchema,
  MemoryWriteInputSchema,
  WebFetchInputSchema,
  WebSearchInputSchema,
} from './app-capability-ops.js';
import { AppEventChannelSchema } from './apps.js';
import {
  WidgetConfigSchema,
  WidgetDeclSchema,
  WidgetFamilySchema,
  WidgetIdSchema,
} from './widgets.js';

/**
 * Messages between the service (parent) and one app backend child process over Node's
 * `child_process` IPC channel (JSON serialization). Each side validates every message it receives
 * against its union. `id`s are unique per sender: the parent numbers its `call` and `widget`
 * requests, the child its `cap` requests; replies and cancels reuse the request's id.
 */

/** Largest serialized message either side sends; a larger one fails its request. */
export const MAX_IPC_MESSAGE_BYTES = 4 * 1024 * 1024;

export const IpcIdSchema = Type.String({ minLength: 1, maxLength: 64 });

const Message = <P extends Record<string, TSchema>>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

const capRequest = <C extends string, O extends string, I extends TSchema>(
  cap: C,
  op: O,
  input: I,
) =>
  Message({
    t: Type.Literal('cap'),
    id: IpcIdSchema,
    cap: Type.Literal(cap),
    op: Type.Literal(op),
    input,
  });

/**
 * A capability request from the backend, one variant per operation (`app-capability-ops.ts`).
 * The parent checks the manifest and the app's grants (asking for consent first when the
 * capability was never answered), then answers with `capChunk`s for streaming operations and one
 * `capResult`.
 */
export const AppCapRequestSchema = Type.Union([
  capRequest('ai', 'generate', AiGenerateInputSchema),
  capRequest('ai', 'stream', AiGenerateInputSchema),
  capRequest('agent', 'run', AgentRunInputSchema),
  capRequest('memory', 'search', MemorySearchInputSchema),
  capRequest('memory', 'read', MemoryReadInputSchema),
  capRequest('memory', 'write', MemoryWriteInputSchema),
  capRequest('mcp', 'listTools', McpListToolsInputSchema),
  capRequest('mcp', 'callTool', McpCallToolInputSchema),
  capRequest('web', 'search', WebSearchInputSchema),
  capRequest('web', 'fetch', WebFetchInputSchema),
]);
export type AppCapRequest = Static<typeof AppCapRequestSchema>;

/** Backend → service. */
export const AppChildMessageSchema = Type.Union([
  /** Loaded and listening: its API function names and declared widgets. */
  Message({
    t: Type.Literal('ready'),
    api: Type.Array(AppApiNameSchema, { maxItems: 256 }),
    widgets: Type.Array(WidgetDeclSchema, { maxItems: 16 }),
  }),
  /** The next piece of a streaming `call`'s answer. */
  Message({ t: Type.Literal('chunk'), id: IpcIdSchema, data: Type.Unknown() }),
  /** The end of a `call` (its return value) or a `widget` render (a `WidgetTimeline`). */
  Message({
    t: Type.Literal('result'),
    id: IpcIdSchema,
    ok: Type.Literal(true),
    value: Type.Unknown(),
  }),
  Message({
    t: Type.Literal('result'),
    id: IpcIdSchema,
    ok: Type.Literal(false),
    error: AppErrorSchema,
  }),
  AppCapRequestSchema,
  /** The backend no longer needs the answer to its `cap` request `id`. */
  Message({ t: Type.Literal('cancel'), id: IpcIdSchema }),
  /** `ctx.events.publish`: fanned out to the app's `/events` subscribers. */
  Message({ t: Type.Literal('event'), channel: AppEventChannelSchema, data: Type.Unknown() }),
  /** `ctx.log` and the backend's stdout/stderr lines; warnings and errors become diagnostics. */
  Message({
    t: Type.Literal('log'),
    level: Type.Union([Type.Literal('info'), Type.Literal('warn'), Type.Literal('error')]),
    message: Type.String({ maxLength: 16000 }),
  }),
  /** `ctx.widgets.reload(id)`: render that widget's live instances again (every widget if absent). */
  Message({ t: Type.Literal('widgetReload'), widgetId: Type.Optional(WidgetIdSchema) }),
]);
export type AppChildMessage = Static<typeof AppChildMessageSchema>;

/** Service → backend. */
export const AppParentMessageSchema = Type.Union([
  /** Runs API function `name`; `stream` asks for `chunk`s before the `result`. */
  Message({
    t: Type.Literal('call'),
    id: IpcIdSchema,
    name: AppApiNameSchema,
    input: Type.Unknown(),
    stream: Type.Boolean(),
  }),
  /** The next chunk of a streaming capability operation; `data` fits the operation's chunk schema. */
  Message({ t: Type.Literal('capChunk'), id: IpcIdSchema, data: Type.Unknown() }),
  /** The end of a capability request; `value` fits the operation's output schema. */
  Message({
    t: Type.Literal('capResult'),
    id: IpcIdSchema,
    ok: Type.Literal(true),
    value: Type.Unknown(),
  }),
  Message({
    t: Type.Literal('capResult'),
    id: IpcIdSchema,
    ok: Type.Literal(false),
    error: AppErrorSchema,
  }),
  /** The caller of `call` or `widget` request `id` went away; the backend should stop it. */
  Message({ t: Type.Literal('cancel'), id: IpcIdSchema }),
  /** Renders one widget for one family; answered by a `result` whose value is a `WidgetTimeline`. */
  Message({
    t: Type.Literal('widget'),
    id: IpcIdSchema,
    widgetId: WidgetIdSchema,
    family: WidgetFamilySchema,
    config: WidgetConfigSchema,
  }),
]);
export type AppParentMessage = Static<typeof AppParentMessageSchema>;
