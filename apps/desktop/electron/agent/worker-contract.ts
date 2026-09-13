import { Type, type Static } from 'typebox';
import { Identifier } from './command-schema';
import { InputSchema, MessageSchema, PermissionSchema, RunSchema } from './task-schema';
import { MemoryEntrySchema } from './bridge';
import { NativeRequestSchema } from './native-schema';

export const WorkerRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('initialize'), root: Type.String(), paused: Type.Boolean() }),
  Type.Object({
    action: Type.Literal('run'),
    taskId: Identifier,
    run: RunSchema,
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    attachments: Type.Array(
      Type.Object({ path: Type.String(), text: Type.String(), name: Type.String() }),
    ),
  }),
  Type.Object({
    action: Type.Literal('messages'),
    taskId: Identifier,
    sessionFile: Type.Union([Type.String(), Type.Null()]),
  }),
  Type.Object({ action: Type.Literal('stop'), runId: Identifier }),
  Type.Object({
    action: Type.Literal('answer'),
    requestId: Identifier,
    answer: Type.Union([Type.String(), Type.Boolean()]),
  }),
  Type.Object({ action: Type.Literal('memory') }),
  Type.Object({ action: Type.Literal('pause'), paused: Type.Boolean() }),
  Type.Object({
    action: Type.Literal('memoryUpdate'),
    entry: MemoryEntrySchema,
    content: Type.String(),
  }),
  Type.Object({ action: Type.Literal('forget'), taskId: Identifier }),
  Type.Object({ action: Type.Literal('shutdown') }),
]);
export type WorkerRequest = Static<typeof WorkerRequestSchema>;
export type WorkerRun = Extract<WorkerRequest, { action: 'run' }>;
export const WorkerInboundSchema = Type.Union([
  Type.Object({ type: Type.Literal('request'), id: Identifier, request: WorkerRequestSchema }),
  Type.Object({
    type: Type.Literal('nativeResponse'),
    id: Identifier,
    ok: Type.Boolean(),
    value: Type.Unknown(),
    error: Type.String(),
  }),
  Type.Object({ type: Type.Literal('nativeData'), id: Identifier, data: Type.String() }),
]);
export const WorkerOutboundSchema = Type.Union([
  Type.Object({ type: Type.Literal('memoryChanged') }),
  Type.Object({
    type: Type.Literal('response'),
    id: Identifier,
    ok: Type.Boolean(),
    value: Type.Unknown(),
    error: Type.String(),
  }),
  Type.Object({ type: Type.Literal('native'), id: Identifier, request: NativeRequestSchema }),
  Type.Object({
    type: Type.Literal('messages'),
    taskId: Identifier,
    runId: Identifier,
    messages: Type.Array(MessageSchema),
    sessionFile: Type.String(),
  }),
  Type.Object({ type: Type.Literal('question'), request: PermissionSchema }),
  Type.Object({
    type: Type.Literal('notice'),
    taskId: Identifier,
    text: Type.String(),
    kind: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  }),
]);
export type WorkerOutbound = Static<typeof WorkerOutboundSchema>;
export const CapturedInputSchema = Type.Pick(InputSchema, ['text', 'capturedAt']);
