import {
  PrepareComputerAccessSchema,
  OpenComputerAccessSchema,
  ComputerAccessCandidateSchema,
  ComputerAccessOpenedSchema,
} from './computer-access.js';
import { Type, type Static } from 'typebox';
import { ComputerActionIdSchema, ComputerRefIdSchema } from './computer-actions.js';
import { ComputerObserveIncludeSchema, ComputerObserveRegionSchema } from './computer-capture.js';
import { ComputerGrantRefSchema } from './computer-grants.js';
import { ComputerProgressSchema } from './computer-progress.js';
import {
  ActionResultSchema,
  ComputerErrorCodeSchema,
  ComputerErrorSchema,
  HostActionRecordSchema,
  ObservationSchema,
} from './computer-results.js';
import { ComputerActionSchema } from './computer-steps.js';
import {
  COMPUTER_MAX_RUN_BINDINGS,
  CapabilityProfileSchema,
  TargetBindingSchema,
  TargetRefSchema,
} from './computer-targets.js';
import { Identifier } from './identifiers.js';
import {
  ScreenShareOperationSchema,
  ScreenShareReplySchema,
  ScreenContextOperationSchema,
  ScreenContextReplySchema,
} from './computer-screen.js';

/**
 * The computer frames of the authenticated control stream (`GET /v1/stream`) between the service
 * and the one shell that holds the computer host lock. They are separate from the desktop
 * capability frames: the service's computer coordinator is their only sender, a request goes only
 * to the bound host connection (never broadcast), and Swift mirrors these shapes by hand in
 * `AICore/Computer`. A timeout or disconnect never counts as "not executed": the service marks the
 * action `unknown` and later asks the host for its journal (`status`).
 */

/**
 * The computer protocol this service speaks (`computer.hello` `host.protocol`). The service binds
 * only a host that speaks exactly this one; any other is recorded busy and computer requests fail
 * `hostUnavailable`. Protocol 8 retired the run mode and the foreground takeover and made
 * refusals and disturbances facts (`computer-refusals.ts`). Protocol 9 adds the host's foreground
 * fallback within one `act` (`ExecutionEnvelope.foregroundAllowed`, `ComputerDelivery`
 * `foreground`, refusal reasons `covered` and `notActivated`).
 */
export const COMPUTER_PROTOCOL = 9;

/** Action ids a `status` request or a `computer.hello` names. */
export const COMPUTER_MAX_STATUS_IDS = 100;
/** Capability profiles one host publishes. */
export const COMPUTER_MAX_PROFILES = 4;

/** Identity of the host process: `hostGeneration` bumps on each shell process start. */
const hostIdentity = {
  hostId: Identifier,
  hostGeneration: Type.Integer({ minimum: 1 }),
};

/**
 * Who an execution is for, injected by the service on every request and never supplied by the
 * model. Read per call from the live run, so a session that outlives a run never reuses its
 * identity. `unattended` runs carry `grantRef`; `deadlineAt` bounds the whole request.
 * `foregroundAllowed` lets the host complete an `act` step in the foreground when no background
 * route can (`ComputerDelivery`), and list `foreground` in the target capabilities a `targets`
 * request resolves. The service sets it only on an `act` or `targets` request of a free run (no
 * recipe: not a trial, not a grant) that is attended, from the run's root execution, about a
 * native target; every other request, the service's own included, carries `false`. The host also
 * requires `unattended` to be `false` before it uses the foreground.
 */
export const ExecutionEnvelopeSchema = Type.Object(
  {
    taskId: Identifier,
    runId: Identifier,
    executionId: Type.String({ maxLength: 256 }),
    toolCallId: Type.String({ maxLength: 256 }),
    operationId: Type.String({ minLength: 1, maxLength: 128 }),
    grantRef: Type.Optional(ComputerGrantRefSchema),
    unattended: Type.Boolean(),
    foregroundAllowed: Type.Boolean(),
    deadlineAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ExecutionEnvelope = Static<typeof ExecutionEnvelopeSchema>;

/**
 * What the service asks the host to do: resolve bindings to target refs, observe a target, act
 * on it, report journal records, or release a target it no longer needs. `observe` collects what
 * `include` names from one surface (`surfaceRefId`; absent: the root window), optionally only a
 * `region` of an earlier capture.
 */
export const HostOperationSchema = Type.Union([
  ScreenShareOperationSchema,
  ScreenContextOperationSchema,
  PrepareComputerAccessSchema,
  OpenComputerAccessSchema,
  Type.Object(
    {
      kind: Type.Literal('targets'),
      bindings: Type.Array(TargetBindingSchema, { maxItems: COMPUTER_MAX_RUN_BINDINGS }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('observe'),
      targetRef: TargetRefSchema,
      surfaceRefId: Type.Optional(ComputerRefIdSchema),
      include: ComputerObserveIncludeSchema,
      region: Type.Optional(ComputerObserveRegionSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('act'), action: ComputerActionSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('status'),
      actionIds: Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_STATUS_IDS }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('release'), targetRef: TargetRefSchema },
    { additionalProperties: false },
  ),
]);
export type HostOperation = Static<typeof HostOperationSchema>;

/**
 * One request to the bound host. `serviceEpoch` is minted per service process start; the host
 * echoes it with `hostId` and `hostGeneration`, and the service rejects a reply whose identity
 * does not match the pending request as stale.
 */
export const HostRequestSchema = Type.Object(
  {
    requestId: Identifier,
    ...hostIdentity,
    serviceEpoch: Identifier,
    envelope: ExecutionEnvelopeSchema,
    op: HostOperationSchema,
  },
  { additionalProperties: false },
);
export type HostRequest = Static<typeof HostRequestSchema>;

/** A successful reply's value, by the operation it answers. */
export const HostReplyValueSchema = Type.Union([
  ScreenShareReplySchema,
  ScreenContextReplySchema,
  ComputerAccessCandidateSchema,
  ComputerAccessOpenedSchema,
  Type.Object(
    {
      kind: Type.Literal('targets'),
      refs: Type.Array(TargetRefSchema, { maxItems: COMPUTER_MAX_RUN_BINDINGS }),
      unavailable: Type.Array(
        Type.Object(
          { bindingId: Identifier, reason: ComputerErrorCodeSchema },
          { additionalProperties: false },
        ),
        { maxItems: COMPUTER_MAX_RUN_BINDINGS },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('observation'), observation: ObservationSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal('actionResult'), result: ActionResultSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('status'),
      records: Type.Array(HostActionRecordSchema, { maxItems: COMPUTER_MAX_STATUS_IDS }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ kind: Type.Literal('released') }, { additionalProperties: false }),
]);
export type HostReplyValue = Static<typeof HostReplyValueSchema>;

const replyIdentity = { requestId: Identifier, ...hostIdentity, serviceEpoch: Identifier };

/**
 * The host's answer to one request. An `act` that dispatched anything answers `ok: true` with its
 * `ActionResult` (which carries its own error); `ok: false` means the operation itself was refused
 * or failed before any dispatch, with the same error shape (a refused `openAccess` names its
 * `reason`, such as `openBrowser`).
 */
export const HostReplySchema = Type.Union([
  Type.Object(
    { ...replyIdentity, ok: Type.Literal(true), value: HostReplyValueSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...replyIdentity, ok: Type.Literal(false), error: ComputerErrorSchema },
    { additionalProperties: false },
  ),
]);
export type HostReply = Static<typeof HostReplySchema>;

/**
 * shell → service, after `subscribe` on every (re)connect. The service binds this connection as
 * the computer host only when `lockHeld` and `protocol` is `COMPUTER_PROTOCOL`; any other host is
 * recorded as busy. `unsettled` lists journal actions without a settled result, which the service
 * reconciles through `status`.
 */
export const ComputerHelloFrameSchema = Type.Object(
  {
    type: Type.Literal('computer.hello'),
    host: Type.Object(
      {
        ...hostIdentity,
        protocol: Type.Integer({ minimum: 1 }),
        lockHeld: Type.Boolean(),
        profiles: Type.Array(CapabilityProfileSchema, { maxItems: COMPUTER_MAX_PROFILES }),
        unsettled: Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_STATUS_IDS }),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type ComputerHelloFrame = Static<typeof ComputerHelloFrameSchema>;

/** service → shell: one request, to the bound host connection only. */
export const ComputerRequestFrameSchema = Type.Object(
  { type: Type.Literal('computer.request'), request: HostRequestSchema },
  { additionalProperties: false },
);
export type ComputerRequestFrame = Static<typeof ComputerRequestFrameSchema>;

/** shell → service: the answer to one request. */
export const ComputerReplyFrameSchema = Type.Object(
  { type: Type.Literal('computer.reply'), reply: HostReplySchema },
  { additionalProperties: false },
);
export type ComputerReplyFrame = Static<typeof ComputerReplyFrameSchema>;

/** shell → service: live progress; display state, not persisted per frame. */
export const ComputerProgressFrameSchema = Type.Object(
  { type: Type.Literal('computer.progress'), progress: ComputerProgressSchema },
  { additionalProperties: false },
);
export type ComputerProgressFrame = Static<typeof ComputerProgressFrameSchema>;

/**
 * Why the service cancels: the run was stopped, it timed out, its grant was revoked or its binding
 * deleted, or the service is shutting down. `finished`: the service's run ended normally; the host
 * ends the run's shares and previews, quits run-scoped managed browser profiles, and releases
 * per-target preparation such as occlusion keep-alive.
 */
export const ComputerCancelReasonSchema = Type.Union([
  Type.Literal('stopped'),
  Type.Literal('finished'),
  Type.Literal('timedOut'),
  Type.Literal('revoked'),
  Type.Literal('shuttingDown'),
]);
export type ComputerCancelReason = Static<typeof ComputerCancelReasonSchema>;

/**
 * service → shell: stop the run's work (one operation when `operationId` is set). The host stops
 * before the next step and still sends the terminal reply of any request in flight, which the
 * service waits a bounded time for before resolving the tool `cancelled` or `unknown`.
 */
export const ComputerCancelFrameSchema = Type.Object(
  {
    type: Type.Literal('computer.cancel'),
    runId: Identifier,
    operationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    reason: ComputerCancelReasonSchema,
  },
  { additionalProperties: false },
);
export type ComputerCancelFrame = Static<typeof ComputerCancelFrameSchema>;

/** Every computer frame the shell sends. */
export const ComputerShellFrameSchema = Type.Union([
  ComputerHelloFrameSchema,
  ComputerReplyFrameSchema,
  ComputerProgressFrameSchema,
]);
export type ComputerShellFrame = Static<typeof ComputerShellFrameSchema>;

/** Every computer frame the service sends. */
export const ComputerServiceFrameSchema = Type.Union([
  ComputerRequestFrameSchema,
  ComputerCancelFrameSchema,
]);
export type ComputerServiceFrame = Static<typeof ComputerServiceFrameSchema>;
