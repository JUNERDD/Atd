import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { CapabilityRequestSchema, PermissionRequestSchema } from './confirms.js';
import { RunStatusSchema } from './task.js';

/** Execution identity: `root:<runId>` today; T5 adds `child:<runId>:<n>`. */
export function rootExecutionId(runId: string): string {
  return `root:${runId}`;
}

export const EventTypeSchema = Type.Union([
  Type.Literal('run.status'),
  Type.Literal('transcript.patch'),
  /** Data is the task's whole `QueueState` (snapshot.ts) after each queue, delivery or removal. */
  Type.Literal('queue.update'),
  Type.Literal('confirm.requested'),
  Type.Literal('confirm.resolved'),
  Type.Literal('capability.requested'),
  Type.Literal('capability.resolved'),
  Type.Literal('notice'),
]);
export type EventType = Static<typeof EventTypeSchema>;

/**
 * Service event envelope. `(epoch, seq)` orders the stream: seq is monotonic
 * within an epoch, and a new epoch means the client must take a snapshot.
 */
export const ServiceEventSchema = Type.Object(
  {
    serviceId: Identifier,
    protocolVersion: Type.String({ maxLength: 16 }),
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 1 }),
    taskId: Identifier,
    runId: Type.Union([Identifier, Type.Null()]),
    executionId: Type.String({ maxLength: 256 }),
    type: EventTypeSchema,
    at: Type.String(),
    data: Type.Unknown(),
  },
  { additionalProperties: false },
);
export type ServiceEvent = Static<typeof ServiceEventSchema>;

export const RunStatusDataSchema = Type.Object(
  {
    status: RunStatusSchema,
    error: Type.String(),
  },
  { additionalProperties: false },
);
export type RunStatusData = Static<typeof RunStatusDataSchema>;

/** Transcript patch; blocks follow the desktop block shape (see snapshot.ts). */
export const TranscriptPatchDataSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    snapshot: Type.Boolean(),
    blocks: Type.Array(Type.Unknown()),
    removed: Type.Array(Type.String({ maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type TranscriptPatchData = Static<typeof TranscriptPatchDataSchema>;

export const ConfirmRequestedDataSchema = Type.Object(
  {
    request: PermissionRequestSchema,
  },
  { additionalProperties: false },
);
export type ConfirmRequestedData = Static<typeof ConfirmRequestedDataSchema>;

export const ConfirmResolvedDataSchema = Type.Object(
  {
    requestId: Identifier,
    outcome: Type.String({ maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type ConfirmResolvedData = Static<typeof ConfirmResolvedDataSchema>;

export const CapabilityRequestedDataSchema = Type.Object(
  {
    request: CapabilityRequestSchema,
  },
  { additionalProperties: false },
);
export type CapabilityRequestedData = Static<typeof CapabilityRequestedDataSchema>;

export const CapabilityResolvedDataSchema = Type.Object(
  {
    requestId: Identifier,
    ok: Type.Boolean(),
    error: Type.String({ maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type CapabilityResolvedData = Static<typeof CapabilityResolvedDataSchema>;

export const NoticeDataSchema = Type.Object(
  {
    text: Type.String({ maxLength: 4000 }),
    kind: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  },
  { additionalProperties: false },
);
export type NoticeData = Static<typeof NoticeDataSchema>;
