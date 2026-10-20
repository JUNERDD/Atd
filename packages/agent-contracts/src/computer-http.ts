import { Type, type Static } from 'typebox';
import { ComputerActionIdSchema, ComputerHashSchema } from './computer-actions.js';
import { COMPUTER_MAX_PROFILES } from './computer-control.js';
import { ComputerGrantSchema, ComputerTrialSchema } from './computer-grants.js';
import { AutomationComputerPolicySchema } from './computer-recipes.js';
import {
  COMPUTER_MAX_BINDINGS,
  COMPUTER_MAX_RUN_BINDINGS,
  CapabilityProfileSchema,
  TargetBindingContentSchema,
  TargetBindingSchema,
} from './computer-targets.js';
import { Identifier } from './identifiers.js';

/**
 * HTTP bodies of the computer routes. Renderer routes read status, delete bindings, stop all
 * computer work, resolve facts a person checked, start a trial and resolve a hold; the shell-only routes write binding content
 * from a host-prepared target and turn a native confirmation into a grant. No renderer route can
 * write a binding's content or a grant.
 */

/**
 * The computer host as the service sees it: `ready` (a shell holds the host lock and is bound),
 * `locked` (a shell is connected but another process holds the lock), `unavailable` (no shell).
 */
export const ComputerHostStateSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('locked'),
  Type.Literal('unavailable'),
]);
export type ComputerHostState = Static<typeof ComputerHostStateSchema>;

/** GET `/v1/computer`: the host, the registered bindings and which of them are in use. */
export const ComputerStatusResponseSchema = Type.Object(
  {
    host: Type.Object(
      {
        state: ComputerHostStateSchema,
        hostGeneration: Type.Optional(Type.Integer({ minimum: 1 })),
        /** What the bound host published; empty unless `ready`. */
        profiles: Type.Array(CapabilityProfileSchema, { maxItems: COMPUTER_MAX_PROFILES }),
      },
      { additionalProperties: false },
    ),
    bindings: Type.Array(TargetBindingSchema, { maxItems: COMPUTER_MAX_BINDINGS }),
    /** Bindings a run is acting on right now. */
    busy: Type.Array(
      Type.Object(
        { bindingId: Identifier, taskId: Identifier, runId: Identifier },
        { additionalProperties: false },
      ),
      { maxItems: COMPUTER_MAX_BINDINGS },
    ),
  },
  { additionalProperties: false },
);
export type ComputerStatusResponse = Static<typeof ComputerStatusResponseSchema>;

/**
 * DELETE `/v1/computer/bindings/:id`: invalidates every grant naming the binding first, then asks
 * the host to release its targets. Lists the automations that now need authorizing again.
 */
export const DeleteComputerBindingResponseSchema = Type.Object(
  { invalidatedAutomationIds: Type.Array(Identifier, { maxItems: 100 }) },
  { additionalProperties: false },
);
export type DeleteComputerBindingResponse = Static<typeof DeleteComputerBindingResponseSchema>;

/** POST `/v1/computer/stop-all`: the runs whose computer work was cancelled. */
export const StopAllComputerResponseSchema = Type.Object(
  { stoppedRunIds: Type.Array(Identifier, { maxItems: 100 }) },
  { additionalProperties: false },
);
export type StopAllComputerResponse = Static<typeof StopAllComputerResponseSchema>;

/** Actions one resolve request names. */
export const COMPUTER_MAX_RESOLVE_IDS = 20;

/**
 * POST `/v1/computer/facts/resolve`: a person checked what the named actions of a task did. Every
 * one that exists, belongs to the task and is still unresolved gets a fact record with
 * `resolution: {kind: 'person'}`, which lifts the gate it held on its target.
 */
export const ComputerResolveFactsRequestSchema = Type.Object(
  {
    taskId: Identifier,
    actionIds: Type.Array(ComputerActionIdSchema, {
      minItems: 1,
      maxItems: COMPUTER_MAX_RESOLVE_IDS,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
);
export type ComputerResolveFactsRequest = Static<typeof ComputerResolveFactsRequestSchema>;

/** The subset of the request's actions that was resolved now. */
export const ComputerResolveFactsResponseSchema = Type.Object(
  { resolved: Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_RESOLVE_IDS }) },
  { additionalProperties: false },
);
export type ComputerResolveFactsResponse = Static<typeof ComputerResolveFactsResponseSchema>;

/** Actions one unresolved listing names at most. */
export const COMPUTER_MAX_UNRESOLVED_LISTED = 100;

/**
 * GET `/v1/computer/facts/unresolved?taskId=`: the task's actions whose non-read outcome is still
 * unresolved (any of its runs), which block further writes on their targets until resolved.
 */
export const ComputerUnresolvedFactsResponseSchema = Type.Object(
  {
    actionIds: Type.Array(ComputerActionIdSchema, { maxItems: COMPUTER_MAX_UNRESOLVED_LISTED }),
  },
  { additionalProperties: false },
);
export type ComputerUnresolvedFactsResponse = Static<typeof ComputerUnresolvedFactsResponseSchema>;

/**
 * POST `/v1/computer/bindings`, shell only: registers a host-prepared target, or updates binding
 * `bindingId` when set (409 when `expectedRevision` moved on). The service assigns revision and
 * hash; a content change bumps both and invalidates grants naming the binding.
 */
export const SaveComputerBindingRequestSchema = Type.Object(
  {
    bindingId: Type.Optional(Identifier),
    expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    content: TargetBindingContentSchema,
  },
  { additionalProperties: false },
);
export type SaveComputerBindingRequest = Static<typeof SaveComputerBindingRequestSchema>;

export const SaveComputerBindingResponseSchema = Type.Object(
  { binding: TargetBindingSchema },
  { additionalProperties: false },
);
export type SaveComputerBindingResponse = Static<typeof SaveComputerBindingResponseSchema>;

/**
 * GET `/v1/admin/approvals/automation-computer/:automationId`, shell only: the exact scope a grant
 * would approve, which the shell shows in its native confirmation. `trial` is the passed trial
 * matching the current content, null when there is none (then nothing can be approved).
 * `approvalHash` covers every hash below; the approve request echoes it.
 */
export const AutomationComputerApprovalDetailsSchema = Type.Object(
  {
    automationId: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    policy: AutomationComputerPolicySchema,
    bindings: Type.Array(TargetBindingSchema, { maxItems: COMPUTER_MAX_RUN_BINDINGS }),
    definitionHash: ComputerHashSchema,
    recipeHash: ComputerHashSchema,
    commandFingerprint: Type.Optional(ComputerHashSchema),
    trial: Type.Union([ComputerTrialSchema, Type.Null()]),
    approvalHash: ComputerHashSchema,
  },
  { additionalProperties: false },
);
export type AutomationComputerApprovalDetails = Static<
  typeof AutomationComputerApprovalDetailsSchema
>;

/**
 * POST `/v1/admin/approvals/automation-computer`, shell only: approves what the shell showed. The
 * service recomputes every hash and answers 409 when the revision or `approvalHash` moved on;
 * otherwise it writes the grant with the definition in one store change.
 */
export const AutomationComputerApproveRequestSchema = Type.Object(
  {
    automationId: Identifier,
    expectedRevision: Type.Integer({ minimum: 1 }),
    approvalHash: ComputerHashSchema,
  },
  { additionalProperties: false },
);
export type AutomationComputerApproveRequest = Static<
  typeof AutomationComputerApproveRequestSchema
>;

export const AutomationComputerApproveResponseSchema = Type.Object(
  { grant: ComputerGrantSchema },
  { additionalProperties: false },
);
export type AutomationComputerApproveResponse = Static<
  typeof AutomationComputerApproveResponseSchema
>;

/**
 * POST `/v1/automations/:id/computer-trial`: starts an attended trial run of the saved recipe
 * (409 when the revision moved on). The trial is recorded from host-verified facts when it ends.
 */
export const ComputerTrialRequestSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type ComputerTrialRequest = Static<typeof ComputerTrialRequestSchema>;

export const ComputerTrialResponseSchema = Type.Object(
  { trialId: Identifier, taskId: Identifier, runId: Identifier },
  { additionalProperties: false },
);
export type ComputerTrialResponse = Static<typeof ComputerTrialResponseSchema>;

/**
 * POST `/v1/automations/:id/computer-hold/resolve`: a person reviewed the run that set the hold
 * and clears it. `runId` must name that run (409 otherwise).
 */
export const ResolveComputerHoldRequestSchema = Type.Object(
  { runId: Identifier, acknowledged: Type.Literal(true) },
  { additionalProperties: false },
);
export type ResolveComputerHoldRequest = Static<typeof ResolveComputerHoldRequestSchema>;

export const ResolveComputerHoldResponseSchema = Type.Object(
  { resolved: Type.Literal(true) },
  { additionalProperties: false },
);
export type ResolveComputerHoldResponse = Static<typeof ResolveComputerHoldResponseSchema>;

/**
 * What the renderer's `computer.authorizeAutomation` bridge call answers (mirrored by the native
 * bridge contract). `cancelled`: dismissed; `changed`: the content moved on between the dialog and
 * the approve (409); `notQualified`: no passed trial matches; `unavailable`: no service connection;
 * `busy`: another native dialog is showing.
 */
export const ComputerAuthorizationResultSchema = Type.Union([
  Type.Object(
    { approved: Type.Literal(true), grantId: Identifier, version: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      approved: Type.Literal(false),
      reason: Type.Union([
        Type.Literal('cancelled'),
        Type.Literal('changed'),
        Type.Literal('notQualified'),
        Type.Literal('unavailable'),
        Type.Literal('busy'),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type ComputerAuthorizationResult = Static<typeof ComputerAuthorizationResultSchema>;

/**
 * What `computer.prepareBrowser` and `computer.prepareApplication` answer once the host
 * registered the prepared target (`POST /v1/computer/bindings`): the new binding, or why not. An
 * application's `probe` is what a read-only look found (standard windows, whether the tree and a
 * screenshot were readable); it never opens or activates the app. `unsupported`: the app cannot
 * be a target; `notInstalled`: the app is not at its path.
 */
export const ComputerPrepareResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      bindingId: Identifier,
      revision: Type.Integer({ minimum: 1 }),
      probe: Type.Optional(
        Type.Object(
          {
            windows: Type.Integer({ minimum: 0 }),
            tree: Type.Boolean(),
            screenshot: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([
        Type.Literal('cancelled'),
        Type.Literal('unavailable'),
        Type.Literal('busy'),
        Type.Literal('unsupported'),
        Type.Literal('notInstalled'),
      ]),
    },
    { additionalProperties: false },
  ),
]);
export type ComputerPrepareResult = Static<typeof ComputerPrepareResultSchema>;
