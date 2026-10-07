import { Type } from 'typebox';
import {
  MemoryCreateRequestSchema,
  MemorySaveRequestSchema,
  MemorySettingsRequestSchema,
  SessionEntryId,
} from '@atd/agent-contracts';
import { CommandSchema, Identifier } from './command-schema';
import { PermissionAnswerSchema, PermissionTierSchema } from './permission-schema';
import { RunPolicySchema } from './run-policy';
import { InputSchema } from './task-schema';
import { ChildKeySchema } from './transcript-schema';
import { MAX_CAPTURE_LENGTH, SaveContentSchema } from '../../native-bridge/calls';

/**
 * Every request a window hands the agent request handler (`AgentRequests`), as the `AgentBridge`
 * methods build them. Clients take its type, `AgentRequest`, from `bridge.ts`.
 */
export const AgentRequestSchema = Type.Union([
  Type.Object({ action: Type.Literal('get') }),
  Type.Object({ action: Type.Literal('detail'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('saveCommand'),
    command: CommandSchema,
    expectedRevision: Type.Integer({ minimum: 0 }),
  }),
  Type.Object({
    action: Type.Literal('deleteCommand'),
    commandId: Identifier,
    revision: Type.Integer({ minimum: 1 }),
  }),
  Type.Object({ action: Type.Literal('prepare'), commandId: Identifier }),
  Type.Object({
    action: Type.Literal('launch'),
    commandId: Identifier,
    prepared: Type.Union([
      Type.Object({ input: InputSchema, revision: Type.Integer({ minimum: 1 }) }),
      Type.Null(),
    ]),
  }),
  Type.Object({
    action: Type.Literal('prepareWithText'),
    commandId: Identifier,
    /** Stands in for the selection the command reads; see `AgentBridge.prepareWithText`. */
    text: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
  }),
  Type.Object({
    action: Type.Literal('capture'),
    source: Type.Union([Type.Literal('selection'), Type.Literal('clipboard')]),
  }),
  Type.Object({
    action: Type.Literal('preview'),
    policy: Type.Union([RunPolicySchema, Type.Null()]),
    input: InputSchema,
    command: Type.Union([CommandSchema, Type.Null()]),
  }),
  Type.Object({
    action: Type.Literal('submit'),
    policy: Type.Union([RunPolicySchema, Type.Null()]),
    invocationId: Identifier,
    taskId: Type.Union([Identifier, Type.Null()]),
    commandId: Type.Union([Identifier, Type.Null()]),
    commandRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    savedRun: Type.Union([Type.Object({ taskId: Identifier, runId: Identifier }), Type.Null()]),
    input: InputSchema,
    /** The task's user message entry this run's prompt replaces (edit and resend, regenerate). */
    branchBefore: Type.Optional(SessionEntryId),
    /**
     * Starts the new task as a side chat of this conversation (`SubmitTaskRequest.sideChatOf`):
     * only without `taskId`, and the conversation must exist.
     */
    sideChatOf: Type.Optional(Identifier),
  }),
  Type.Object({ action: Type.Literal('stop'), taskId: Identifier, runId: Identifier }),
  Type.Object({
    action: Type.Literal('answer'),
    taskId: Identifier,
    runId: Identifier,
    requestId: Identifier,
    answer: PermissionAnswerSchema,
  }),
  Type.Object({
    action: Type.Literal('queueMessage'),
    taskId: Identifier,
    text: Type.String({ minLength: 1, maxLength: 100000 }),
    /** `followUp` waits for the turn to end; `steer` is injected after the current tool calls. */
    mode: Type.Union([Type.Literal('followUp'), Type.Literal('steer')]),
  }),
  Type.Object({
    action: Type.Literal('replaceQueue'),
    taskId: Identifier,
    followUp: Type.Array(Type.String({ minLength: 1, maxLength: 100000 }), { maxItems: 50 }),
  }),
  Type.Object({
    action: Type.Literal('setPermissionTier'),
    taskId: Identifier,
    tier: PermissionTierSchema,
  }),
  Type.Object({
    action: Type.Literal('renameTask'),
    taskId: Identifier,
    title: Type.String({ minLength: 1, maxLength: 120 }),
  }),
  Type.Object({ action: Type.Literal('deleteTask'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('compactTask'),
    taskId: Identifier,
    /** Focus for the summary (`/compact <focus>`); the service caps it at 2000 characters. */
    instructions: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
  }),
  Type.Object({ action: Type.Literal('contextBreakdown'), taskId: Identifier }),
  Type.Object({
    action: Type.Literal('forkTask'),
    taskId: Identifier,
    /** The user message entry of the turn the fork ends with. */
    entryId: SessionEntryId,
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  }),
  Type.Object({ action: Type.Literal('chooseFiles') }),
  Type.Object({
    action: Type.Literal('saveFile'),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    content: SaveContentSchema,
  }),
  // Memory: one action per `@atd/agent-client` memory call (`memory-manage.ts` runs them).
  Type.Object({ action: Type.Literal('memory') }),
  Type.Object({
    action: Type.Literal('saveMemorySettings'),
    settings: MemorySettingsRequestSchema,
  }),
  Type.Object({ action: Type.Literal('createMemoryUnit'), input: MemoryCreateRequestSchema }),
  Type.Object({ action: Type.Literal('saveMemoryUnit'), input: MemorySaveRequestSchema }),
  Type.Object({ action: Type.Literal('deleteMemoryUnit'), id: Identifier }),
  Type.Object({
    action: Type.Literal('toggleMemoryUnit'),
    id: Identifier,
    enabled: Type.Boolean(),
  }),
  Type.Object({ action: Type.Literal('markMemoryUnitReviewed'), id: Identifier }),
  Type.Object({ action: Type.Literal('acceptMemoryProposal'), id: Identifier }),
  Type.Object({ action: Type.Literal('dismissMemoryProposal'), id: Identifier }),
  Type.Object({
    action: Type.Literal('artifact'),
    artifactId: Identifier,
    operation: Type.Union([
      Type.Literal('open'),
      Type.Literal('reveal'),
      Type.Literal('copy'),
      Type.Literal('locate'),
      Type.Literal('attach'),
    ]),
  }),
  Type.Object({ action: Type.Literal('copy'), text: Type.String({ maxLength: 1000000 }) }),
  Type.Object({ action: Type.Literal('openLink'), url: Type.String({ maxLength: 8192 }) }),
  Type.Object({
    action: Type.Literal('childTranscript'),
    taskId: Identifier,
    childKey: ChildKeySchema,
  }),
  Type.Object({
    action: Type.Literal('releaseChildTranscript'),
    taskId: Identifier,
    childKey: ChildKeySchema,
  }),
]);
