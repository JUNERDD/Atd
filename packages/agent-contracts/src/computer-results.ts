import { Type, type Static } from 'typebox';
import {
  COMPUTER_MAX_RESOLVE_IDS,
  COMPUTER_MAX_STEPS,
  ComputerActionIdSchema,
  ComputerDeliverySchema,
  ComputerEffectSchema,
  ComputerRefIdSchema,
  ComputerRouteSchema,
  ComputerStepKindSchema,
} from './computer-actions.js';
import {
  COMPUTER_MAX_TEXT_BOXES,
  ComputerCaptureSchema,
  ComputerObservationProblemSchema,
  ComputerRectSchema,
  ComputerTextBoxSchema,
} from './computer-capture.js';
import {
  COMPUTER_MAX_DISTURBANCES,
  ComputerDisturbanceSchema,
  ComputerRefusalReasonSchema,
} from './computer-refusals.js';
import { COMPUTER_MAX_SURFACES, SurfaceRefSchema } from './computer-surfaces.js';
import { ComputerVisualStateSchema } from './computer-visual.js';
import { Identifier } from './identifiers.js';
import { ComputerMenuPathSchema } from './computer-locators.js';

/**
 * What the host observed and what an action actually did. Results are structured facts: neither a
 * tool's `isError` nor the model's final text is authoritative about a side effect, and an
 * observation error never erases an execution fact.
 */

export const COMPUTER_MAX_ELEMENTS = 300;
export const COMPUTER_MAX_EVIDENCE = 20;
/** The largest base64 screenshot a host sends (an 8 MiB resource, encoded). */
export const COMPUTER_SCREENSHOT_MAX_BASE64 = 11184812;

/**
 * Why a host refused or could not finish a request (closed). `notQualified`: the engine profile
 * cannot serve this run; `targetUnavailable`: the target cannot be reached or read right now;
 * `targetChanged` / `staleObservation`: the ref no longer names what the model saw; `ambiguous` /
 * `notFound`: a locator matched several elements or none; `noBackgroundRoute`: the step has no
 * imperceptible route on this target, so the host refused it instead of taking the foreground
 * (`reason` says which limit; a person can do the step); `needsPermission`: a privacy grant is
 * missing; `needsConsent`: screen capture was never prepared in Settings, and an unattended run
 * never prompts for it; `locked` / `busy`: another host holds the session lock or the resource;
 * `targetInUse`: the person is using the target (it is in front of them and they typed, clicked
 * or scrolled in the last few seconds), so the host yields; `inputInUse`: the person is using the
 * keyboard or pointer right now, in any app, so the host sent nothing rather than open a key
 * scope under their input, and the step can be tried again in a few seconds; `hostUnavailable`:
 * no bound host answered (or it speaks another computer protocol);
 * `modalBlocked`: the step wrote to a surface while a modal child of it was open; `disturbed`:
 * the action disturbed the person (`ActionResult.disturbances` attributes it to the agent), so the
 * host repaired what it could and ended the action; on an app it keeps that route off until the
 * person replies, and until the host restarts once the route disturbed them twice. Records written
 * before protocol 8 may hold retired codes; readers map them (`currentComputerErrorCode`).
 */
export const ComputerErrorCodeSchema = Type.Union([
  Type.Literal('notQualified'),
  Type.Literal('targetUnavailable'),
  Type.Literal('targetChanged'),
  Type.Literal('staleObservation'),
  Type.Literal('ambiguous'),
  Type.Literal('notFound'),
  Type.Literal('noBackgroundRoute'),
  Type.Literal('needsPermission'),
  Type.Literal('needsConsent'),
  Type.Literal('locked'),
  Type.Literal('busy'),
  Type.Literal('targetInUse'),
  Type.Literal('inputInUse'),
  Type.Literal('cancelled'),
  Type.Literal('timeout'),
  Type.Literal('unsupported'),
  Type.Literal('engineFailed'),
  Type.Literal('hostUnavailable'),
  Type.Literal('modalBlocked'),
  Type.Literal('disturbed'),
]);
export type ComputerErrorCode = Static<typeof ComputerErrorCodeSchema>;

/** A refusal or failure; `reason` names the background limit behind it, when one did. */
export const ComputerErrorSchema = Type.Object(
  {
    code: ComputerErrorCodeSchema,
    message: Type.String({ maxLength: 2000 }),
    reason: Type.Optional(ComputerRefusalReasonSchema),
  },
  { additionalProperties: false },
);
export type ComputerError = Static<typeof ComputerErrorSchema>;

/**
 * Identity of one observation. It is invalidated by a navigation, a DOM identity change, an app
 * restart or an engine restart; element refs are valid only with it.
 */
export const ObservationRefSchema = Type.Object(
  {
    id: ComputerRefIdSchema,
    targetRefId: ComputerRefIdSchema,
    version: Type.Integer({ minimum: 1 }),
    capturedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ObservationRef = Static<typeof ObservationRefSchema>;

/**
 * One actionable element. `value` is truncated by the host and secrets are masked; `frame` is in
 * pixels of the observation's `capture`, set only when the observation has one.
 */
export const ObservationElementSchema = Type.Object(
  {
    ref: ComputerRefIdSchema,
    role: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.Optional(Type.String({ maxLength: 200 })),
    value: Type.Optional(Type.String({ maxLength: 200 })),
    enabled: Type.Boolean(),
    focused: Type.Optional(Type.Boolean()),
    frame: Type.Optional(ComputerRectSchema),
  },
  { additionalProperties: false },
);
export type ObservationElement = Static<typeof ObservationElementSchema>;

/**
 * A host observation of one surface (`surfaceRefId`; absent: the target's root window). The tree
 * and the capture share the observation id but are adjacent collections, not one atomic snapshot:
 * `treeCapturedAt` and `capture.capturedAt` say when each was taken, and `problems` reports what
 * failed or disagreed. `screenshot` travels host → service only: the service saves it as a
 * task-owned resource and strips the base64 before anything reaches the model or the transcript;
 * `capture` describes it. `surfaces` lists the target's surfaces the host attributes to it, and
 * `capabilities` the effects the target accepts right now.
 */
export const ObservationSchema = Type.Object(
  {
    ref: ObservationRefSchema,
    surfaceRefId: Type.Optional(ComputerRefIdSchema),
    surfaces: Type.Optional(Type.Array(SurfaceRefSchema, { maxItems: COMPUTER_MAX_SURFACES })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    title: Type.Optional(Type.String({ maxLength: 500 })),
    treeCapturedAt: Type.Optional(Type.String()),
    elements: Type.Array(ObservationElementSchema, { maxItems: COMPUTER_MAX_ELEMENTS }),
    /** Read-only native application menu state, separate from window element refs. */
    menuItems: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: ComputerMenuPathSchema,
            enabled: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
        { maxItems: COMPUTER_MAX_ELEMENTS },
      ),
    ),
    screenshot: Type.Optional(
      Type.Object(
        {
          mime: Type.Union([Type.Literal('image/png'), Type.Literal('image/jpeg')]),
          base64: Type.String({ minLength: 1, maxLength: COMPUTER_SCREENSHOT_MAX_BASE64 }),
        },
        { additionalProperties: false },
      ),
    ),
    capture: Type.Optional(ComputerCaptureSchema),
    text: Type.Optional(Type.Array(ComputerTextBoxSchema, { maxItems: COMPUTER_MAX_TEXT_BOXES })),
    problems: Type.Optional(
      Type.Array(ComputerObservationProblemSchema, { maxItems: 6, uniqueItems: true }),
    ),
    capabilities: Type.Array(ComputerEffectSchema, { maxItems: 8, uniqueItems: true }),
  },
  { additionalProperties: false },
);
export type Observation = Static<typeof ObservationSchema>;

/** A piece of evidence an action left; `resourceId` names a task-owned resource (a screenshot). */
export const ComputerEvidenceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('value'),
      Type.Literal('text'),
      Type.Literal('url'),
      Type.Literal('file'),
      Type.Literal('screenshot'),
    ]),
    summary: Type.String({ maxLength: 500 }),
    resourceId: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type ComputerEvidence = Static<typeof ComputerEvidenceSchema>;

/** Downloads one action result reports. */
export const COMPUTER_MAX_DOWNLOADS = 5;

/**
 * A file the browser downloaded while an action ran, as the host saved it: only under
 * `<dataDir>/computer/downloads/<runId>/`. The service imports it as a task resource, deletes the
 * staged file and never records or shows `path`.
 */
export const ComputerDownloadSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    path: Type.String({ minLength: 2, maxLength: 4096, pattern: '^/' }),
    bytes: Type.Integer({ minimum: 0 }),
    mime: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  },
  { additionalProperties: false },
);
export type ComputerDownload = Static<typeof ComputerDownloadSchema>;

/**
 * What one action did. `dispatch`: whether any step reached the target (`settled`: the host saw
 * its last dispatched step finish). `effect`: `none` (nothing changed), `partial` (input reached
 * the target but its outcome is not confirmed: the action stopped after some writes, or every step
 * ran and the postcondition did not hold, which `evidence` then says), `unknown` (dispatched with
 * no way to know), `verified` (the postcondition held).
 * `completedSteps` counts steps that finished; `stoppedAt` is the index of the step that stopped
 * the action. `retry`: `safe` when no write reached the target, `never` when a business step did
 * or may have, and `after_review` when only non-business writes reached it. `invalidated` names
 * what the action made stale (an observation, a target ref).
 * `delivery` and `route` say how it was actually delivered, when the host knows. `disturbances`
 * lists what the host's guard saw change for the person while the action ran, whoever caused it;
 * one the guard attributes to the agent ends the action `disturbed`. `downloads` lists the
 * completed downloads the action caused (host → service only).
 */
export const ActionResultSchema = Type.Object(
  {
    actionId: ComputerActionIdSchema,
    dispatch: Type.Union([
      Type.Literal('not_dispatched'),
      Type.Literal('dispatched'),
      Type.Literal('settled'),
    ]),
    effect: Type.Union([
      Type.Literal('none'),
      Type.Literal('partial'),
      Type.Literal('unknown'),
      Type.Literal('verified'),
    ]),
    completedSteps: Type.Integer({ minimum: 0, maximum: COMPUTER_MAX_STEPS }),
    stoppedAt: Type.Optional(Type.Integer({ minimum: 0, maximum: COMPUTER_MAX_STEPS - 1 })),
    error: Type.Optional(ComputerErrorSchema),
    evidence: Type.Array(ComputerEvidenceSchema, { maxItems: COMPUTER_MAX_EVIDENCE }),
    retry: Type.Union([Type.Literal('safe'), Type.Literal('never'), Type.Literal('after_review')]),
    invalidated: Type.Optional(Type.String({ maxLength: 500 })),
    delivery: Type.Optional(ComputerDeliverySchema),
    route: Type.Optional(ComputerRouteSchema),
    disturbances: Type.Optional(
      Type.Array(ComputerDisturbanceSchema, { maxItems: COMPUTER_MAX_DISTURBANCES }),
    ),
    downloads: Type.Optional(
      Type.Array(ComputerDownloadSchema, { maxItems: COMPUTER_MAX_DOWNLOADS }),
    ),
  },
  { additionalProperties: false },
);
export type ActionResult = Static<typeof ActionResultSchema>;

/** Where an action stands in a journal: intent recorded, dispatched, or settled with a result. */
export const ComputerActionPhaseSchema = Type.Union([
  Type.Literal('intent'),
  Type.Literal('dispatched'),
  Type.Literal('settled'),
]);
export type ComputerActionPhase = Static<typeof ComputerActionPhaseSchema>;

/**
 * One entry of the host's own journal (`hostjournal.jsonl`), which the host answers `status`
 * from; repeating a request for the same operation returns the recorded result instead of acting
 * again.
 */
export const HostActionRecordSchema = Type.Object(
  {
    actionId: ComputerActionIdSchema,
    runId: Identifier,
    operationId: Type.String({ minLength: 1, maxLength: 128 }),
    hostGeneration: Type.Integer({ minimum: 1 }),
    phase: ComputerActionPhaseSchema,
    result: Type.Optional(ActionResultSchema),
    at: Type.String(),
  },
  { additionalProperties: false },
);
export type HostActionRecord = Static<typeof HostActionRecordSchema>;

/**
 * Transcript details of one `computer` call (`ToolBlockDetails`), projected by the service from
 * the tool's result: the operation, the target's label, a bounded summary of each step, the
 * action's result facts, how it was delivered, the run's visual state an `observe` reported and
 * the task-owned resources it saved (screenshots). `bindingId` names the registered target the
 * call resolved, also when it was refused after that. `actionId` names the action an `act`
 * recorded, also when its reply was lost and it has no result. `error` is the refusal of any other
 * operation (an `observe` without prepared capture consent, a `requestAccess` whose browser is not
 * open), so the transcript can offer the person the matching next step; an `act` carries its
 * refusal in `result.error`. `blockedBy` names the earlier business actions of the task whose
 * unconfirmed outcome held a refused `act` back, so the transcript can offer the person to mark
 * them as checked there.
 */
export const ComputerDetailsSchema = Type.Object(
  {
    type: Type.Literal('computer'),
    op: Type.Union([
      Type.Literal('targets'),
      Type.Literal('requestAccess'),
      Type.Literal('shareScreen'),
      Type.Literal('watchScreen'),
      Type.Literal('stopSharing'),
      Type.Literal('observe'),
      Type.Literal('act'),
      Type.Literal('status'),
      Type.Literal('release'),
    ]),
    target: Type.Optional(Type.String({ maxLength: 120 })),
    bindingId: Type.Optional(Identifier),
    actionId: Type.Optional(ComputerActionIdSchema),
    steps: Type.Array(
      Type.Object(
        {
          kind: ComputerStepKindSchema,
          effect: ComputerEffectSchema,
          summary: Type.String({ maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: COMPUTER_MAX_STEPS },
    ),
    result: Type.Optional(ActionResultSchema),
    error: Type.Optional(ComputerErrorSchema),
    blockedBy: Type.Optional(
      Type.Array(ComputerActionIdSchema, {
        minItems: 1,
        maxItems: COMPUTER_MAX_RESOLVE_IDS,
        uniqueItems: true,
      }),
    ),
    delivery: Type.Optional(ComputerDeliverySchema),
    visual: Type.Optional(ComputerVisualStateSchema),
    resourceIds: Type.Array(Identifier, { maxItems: COMPUTER_MAX_EVIDENCE }),
  },
  { additionalProperties: false },
);
export type ComputerDetails = Static<typeof ComputerDetailsSchema>;
