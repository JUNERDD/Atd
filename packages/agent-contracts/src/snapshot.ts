import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import {
  CapabilityRequestSchema,
  GrantScopeSchema,
  PermissionOutcomeSchema,
  PermissionRequestSchema,
} from './confirms.js';
import { AgentTaskSchema } from './task.js';
import { ToolBlockDetailsSchema } from './tool-details.js';

/**
 * T1 transcript block subset. Field names match the desktop Block shape so T6
 * can converge the two projections without renaming; T1 omits usage/diff
 * details that the service ledger does not need.
 */
const blockBase = {
  id: Type.String({ maxLength: 256 }),
  runId: Identifier,
  timestamp: Type.Number(),
  endedAt: Type.Number(),
};

export const ServiceToolStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('declined'),
  Type.Literal('interrupted'),
]);
export type ServiceToolStatus = Static<typeof ServiceToolStatusSchema>;

export const ServiceBlockSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('user'),
      ...blockBase,
      text: Type.String(),
      /**
       * Set on the run's prompt: the first user message after its `app-invocation`. Clients render
       * a prompt from the run snapshot's input (text plus chips); queued follow-ups stay text.
       */
      prompt: Type.Optional(Type.Literal(true)),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('assistant'),
      ...blockBase,
      text: Type.String(),
      streaming: Type.Boolean(),
      stopReason: Type.Union([
        Type.Literal('stop'),
        Type.Literal('length'),
        Type.Literal('error'),
        Type.Literal('aborted'),
        Type.Null(),
      ]),
      error: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('thinking'),
      ...blockBase,
      text: Type.String(),
      streaming: Type.Boolean(),
      redacted: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('tool'),
      ...blockBase,
      callId: Type.String({ maxLength: 256 }),
      name: Type.String({ maxLength: 128 }),
      args: Type.Record(Type.String(), Type.Unknown()),
      status: ServiceToolStatusSchema,
      output: Type.String(),
      partial: Type.String(),
      permission: Type.Union([
        Type.Object(
          {
            scope: GrantScopeSchema,
            outcome: Type.Union([PermissionOutcomeSchema, Type.Null()]),
          },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      /** C1 additive: whitelisted per-tool result facts (tool-details.ts). */
      details: Type.Optional(ToolBlockDetailsSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('question'),
      ...blockBase,
      callId: Type.String({ maxLength: 256 }),
      title: Type.String(),
      options: Type.Array(Type.String()),
      status: ServiceToolStatusSchema,
      answer: Type.Union([Type.String(), Type.Null()]),
      skipped: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('system'),
      ...blockBase,
      level: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
      text: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
export type ServiceBlock = Static<typeof ServiceBlockSchema>;

export const QueueStateSchema = Type.Object(
  {
    steering: Type.Array(Type.String()),
    followUp: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);
export type QueueState = Static<typeof QueueStateSchema>;

/** Full task state returned after a gap or restart instead of replaying events. */
export const TaskSnapshotSchema = Type.Object(
  {
    task: AgentTaskSchema,
    revision: Type.Integer({ minimum: 0 }),
    blocks: Type.Array(ServiceBlockSchema),
    requests: Type.Array(PermissionRequestSchema),
    capabilities: Type.Array(CapabilityRequestSchema),
    queue: QueueStateSchema,
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type TaskSnapshot = Static<typeof TaskSnapshotSchema>;

/** Client subscription: replay from (epoch, seq), or snapshot when stale. */
export const SubscribeSchema = Type.Object(
  {
    epoch: Type.Integer({ minimum: 0 }),
    seq: Type.Integer({ minimum: 0 }),
    taskIds: Type.Optional(Type.Array(Identifier, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export type Subscribe = Static<typeof SubscribeSchema>;
