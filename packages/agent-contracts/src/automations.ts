import { Type, type Static } from 'typebox';
import { AutomationActionSchema } from './automation-actions.js';
import {
  AutomationResultSchema,
  AutomationTriggerProblemSchema,
  AutomationTriggerSchema,
} from './automation-triggers.js';
import { PermissionTierSchema } from './confirms.js';
import { MAX_FOLDERS } from './folders.js';
import { Identifier } from './identifiers.js';
import { ThinkingLevelSchema } from './models.js';
import { AutomationFireSourceSchema } from './run-trigger.js';
import { ModelSelectionSchema, ServiceToolIdSchema } from './task.js';

/**
 * Automations: saved agent work that starts by itself (docs/plans/2026-10-06-automations.md).
 * An automation is a trigger, an action, the policy its unattended runs follow and how results
 * reach the person. Every run is a new task that goes through the same acceptance path as a
 * manual run (`RunSnapshot.trigger` marks it), so idempotency, queueing and policy stay shared.
 */

export const MAX_AUTOMATIONS = 100;
/** Run records kept per automation; older ones are dropped, newest first. */
export const AUTOMATION_RUN_HISTORY = 100;

/**
 * Schedule occurrences missed while Atd was closed or the Mac slept: run the latest one once,
 * marked late, or skip them all.
 */
export const AutomationMissedRunsSchema = Type.Union([
  Type.Literal('runOnce'),
  Type.Literal('skip'),
]);
export type AutomationMissedRuns = Static<typeof AutomationMissedRunsSchema>;

export const AutomationPolicySchema = Type.Object(
  {
    /**
     * Approval tier of every task the automation starts. Nobody is present to approve, so an
     * action the tier would ask about is declined instead and the run needs attention.
     */
    permissionTier: PermissionTierSchema,
    /**
     * Snapshot tools of a prompt run. A command run uses the command's own tools; absent gives a
     * prompt run reading and file editing without the shell.
     */
    tools: Type.Optional(Type.Array(ServiceToolIdSchema, { uniqueItems: true })),
    /**
     * The model every run uses, winning over a command's fixed model as a panel pick does. Absent:
     * a command's fixed model, else the default connection's default model at fire time.
     */
    model: Type.Optional(ModelSelectionSchema),
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    /** Whether runs search memory. Automation runs never teach memory. */
    memory: Type.Boolean(),
    /** Registered folders every run may read; a folder trigger's own folder is always included. */
    folderIds: Type.Array(Identifier, { maxItems: MAX_FOLDERS, uniqueItems: true }),
    /** A run still going after this long is stopped and counts as failed. */
    maxDurationMinutes: Type.Integer({ minimum: 5, maximum: 240 }),
    missedRuns: AutomationMissedRunsSchema,
  },
  { additionalProperties: false },
);
export type AutomationPolicy = Static<typeof AutomationPolicySchema>;

/**
 * When a finished run posts a notification. `whenNew` asks the agent to say when there is nothing
 * new and stays silent then; runs that fail or need attention always notify.
 */
export const AutomationNotifySchema = Type.Union([
  Type.Literal('whenNew'),
  Type.Literal('always'),
  Type.Literal('never'),
]);
export type AutomationNotify = Static<typeof AutomationNotifySchema>;

export const AutomationDeliverySchema = Type.Object(
  {
    notify: AutomationNotifySchema,
    /** Give each run the previous run's answer, so it can report only what changed. */
    includePreviousResult: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type AutomationDelivery = Static<typeof AutomationDeliverySchema>;

const draftFields = {
  name: Type.String({ minLength: 1, maxLength: 120 }),
  enabled: Type.Boolean(),
  trigger: AutomationTriggerSchema,
  action: AutomationActionSchema,
  policy: AutomationPolicySchema,
  delivery: AutomationDeliverySchema,
};

/** Everything a person or the agent edits; the service adds identity and bookkeeping. */
export const AutomationDraftSchema = Type.Object(draftFields, { additionalProperties: false });
export type AutomationDraft = Static<typeof AutomationDraftSchema>;

export const AutomationSchema = Type.Object(
  {
    id: Identifier,
    /** Bumped on every change; writes name the revision they edited (`expectedRevision`). */
    revision: Type.Integer({ minimum: 1 }),
    ...draftFields,
    /** `agent`: proposed through the agent's `automation` tool and confirmed by the person. */
    createdBy: Type.Union([Type.Literal('user'), Type.Literal('agent')]),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type Automation = Static<typeof AutomationSchema>;

/**
 * Where a run record stands. `running` until its task run ends, then a result
 * (`AutomationResultSchema`), `timedOut`, `stopped` (by the person or by Atd quitting),
 * `interrupted` (the service restarted mid-run), or `skipped` when the occurrence started no run.
 */
export const AutomationOutcomeSchema = Type.Union([
  Type.Literal('running'),
  AutomationResultSchema,
  Type.Literal('timedOut'),
  Type.Literal('stopped'),
  Type.Literal('interrupted'),
  Type.Literal('skipped'),
]);
export type AutomationOutcome = Static<typeof AutomationOutcomeSchema>;

/**
 * Why a run was skipped or failed, for the client's own wording. Skips: the previous run was still
 * going, the occurrence was missed and missed runs are skipped, too many runs in the last hour,
 * every automation is paused, none of the files that fired a command's `{{files}}` can be
 * attached (they are not retried), or memory learning is paused so consolidation may not write.
 * Failures before a task started: no usable model, the command is gone, turned off or needs input
 * an automation cannot give, a folder is unregistered or unreadable, or the service refused the
 * run. Failures after: the agent reported it could not finish, or the task run failed (`detail`
 * says how); a consolidation that fails says how in `detail` under `runFailed`.
 */
export const AutomationRunReasonSchema = Type.Union([
  Type.Literal('overlap'),
  Type.Literal('missed'),
  Type.Literal('rateLimited'),
  Type.Literal('paused'),
  Type.Literal('unsupportedFiles'),
  Type.Literal('memoryPaused'),
  Type.Literal('modelUnavailable'),
  Type.Literal('commandUnavailable'),
  Type.Literal('folderUnavailable'),
  Type.Literal('submitFailed'),
  Type.Literal('agentReported'),
  Type.Literal('runFailed'),
]);
export type AutomationRunReason = Static<typeof AutomationRunReasonSchema>;

export const AutomationRunSchema = Type.Object(
  {
    id: Identifier,
    automationId: Identifier,
    source: AutomationFireSourceSchema,
    /** The schedule occurrence this run serves (schedule triggers). */
    scheduledFor: Type.Optional(Type.String()),
    firedAt: Type.String(),
    /** Started after its time because Atd was closed or the Mac was asleep. */
    late: Type.Optional(Type.Literal(true)),
    outcome: AutomationOutcomeSchema,
    reason: Type.Optional(AutomationRunReasonSchema),
    /** Runtime detail such as an error message; not translated. */
    detail: Type.Optional(Type.String({ maxLength: 2000 })),
    taskId: Type.Optional(Identifier),
    runId: Type.Optional(Identifier),
    /** Opening of the run's final answer, for lists and notifications. */
    summary: Type.Optional(Type.String({ maxLength: 500 })),
    /** Guarded actions declined and questions left unanswered because nobody was present. */
    declined: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Files that fired a folder run, relative to the watched folder. */
    files: Type.Optional(Type.Array(Type.String({ maxLength: 1024 }), { maxItems: 20 })),
    finishedAt: Type.Optional(Type.String()),
    /** When the person opened the result. Skipped and silent runs are recorded as already read. */
    readAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type AutomationRun = Static<typeof AutomationRunSchema>;

/** Why the service turned an automation off: repeated failures, or its one-time run is done. */
export const AutomationPauseReasonSchema = Type.Union([
  Type.Literal('failures'),
  Type.Literal('finished'),
]);
export type AutomationPauseReason = Static<typeof AutomationPauseReasonSchema>;

/** A folder an automation names, as the page may show it: its basename, never its path. */
export const AutomationFolderSchema = Type.Object(
  {
    id: Identifier,
    /** Absent when the folder is no longer registered. */
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  },
  { additionalProperties: false },
);
export type AutomationFolder = Static<typeof AutomationFolderSchema>;

/** Live state the service computes for each automation when listing. */
export const AutomationStatusSchema = Type.Object(
  {
    /** Every folder the automation names: its folder trigger's first, then the policy's. */
    folders: Type.Array(AutomationFolderSchema, { maxItems: MAX_FOLDERS + 1 }),
    /** The next schedule occurrence while the automation is on. */
    nextRunAt: Type.Optional(Type.String()),
    lastRun: Type.Optional(AutomationRunSchema),
    /** Runs whose result the person has not opened. */
    unread: Type.Integer({ minimum: 0 }),
    running: Type.Boolean(),
    /** Set when the service turned it off; cleared when it is turned back on. */
    pausedReason: Type.Optional(AutomationPauseReasonSchema),
    /** Why it cannot fire as saved: its trigger, command, folder or model no longer resolves. */
    problem: Type.Optional(
      Type.Union([
        AutomationTriggerProblemSchema,
        Type.Literal('commandUnavailable'),
        Type.Literal('folderUnavailable'),
        Type.Literal('modelUnavailable'),
      ]),
    ),
  },
  { additionalProperties: false },
);
export type AutomationStatus = Static<typeof AutomationStatusSchema>;

export const AutomationItemSchema = Type.Object(
  { automation: AutomationSchema, status: AutomationStatusSchema },
  { additionalProperties: false },
);
export type AutomationItem = Static<typeof AutomationItemSchema>;

/** GET `/v1/automations`. */
export const AutomationListResponseSchema = Type.Object(
  {
    automations: Type.Array(AutomationItemSchema, { maxItems: MAX_AUTOMATIONS }),
    /** The global pause: nothing fires while it is on (`PATCH /v1/automation-settings`). */
    paused: Type.Boolean(),
    /**
     * The saved automations could not be read, so nothing fires and the file is kept until the
     * next save moves it aside. Runtime text; not translated.
     */
    problem: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export type AutomationListResponse = Static<typeof AutomationListResponseSchema>;

/** PUT `/v1/automations/:id`: refused with 409 when the revision moved on. */
export const UpdateAutomationRequestSchema = Type.Object(
  { expectedRevision: Type.Integer({ minimum: 1 }), automation: AutomationDraftSchema },
  { additionalProperties: false },
);
export type UpdateAutomationRequest = Static<typeof UpdateAutomationRequestSchema>;

/** PATCH `/v1/automations/:id`: the row switch. Turning an automation on clears its pause. */
export const SetAutomationEnabledRequestSchema = Type.Object(
  { enabled: Type.Boolean(), expectedRevision: Type.Optional(Type.Integer({ minimum: 1 })) },
  { additionalProperties: false },
);
export type SetAutomationEnabledRequest = Static<typeof SetAutomationEnabledRequestSchema>;

/** POST `/v1/automations/:id/run`: Run now. A run already in progress answers 409. */
export const RunAutomationResponseSchema = Type.Object(
  { run: AutomationRunSchema },
  { additionalProperties: false },
);
export type RunAutomationResponse = Static<typeof RunAutomationResponseSchema>;

/** GET `/v1/automations/:id/runs?limit=`: newest first. */
export const AutomationRunsResponseSchema = Type.Object(
  { runs: Type.Array(AutomationRunSchema, { maxItems: AUTOMATION_RUN_HISTORY }) },
  { additionalProperties: false },
);
export type AutomationRunsResponse = Static<typeof AutomationRunsResponseSchema>;

/**
 * POST `/v1/automation-runs/read`: marks results opened, by run (the run list) or by the task the
 * panel opened. Unknown ids are ignored.
 */
export const MarkAutomationRunsReadRequestSchema = Type.Object(
  {
    runIds: Type.Optional(Type.Array(Identifier, { maxItems: 100 })),
    taskIds: Type.Optional(Type.Array(Identifier, { maxItems: 100 })),
  },
  { additionalProperties: false },
);
export type MarkAutomationRunsReadRequest = Static<typeof MarkAutomationRunsReadRequestSchema>;

/** POST `/v1/automations/preview`: next run times of a draft trigger, or why it cannot run. */
export const PreviewAutomationTriggerRequestSchema = Type.Object(
  {
    trigger: AutomationTriggerSchema,
    /** The automation being edited, so a chain back to it is reported as a loop. */
    automationId: Type.Optional(Identifier),
    count: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
  },
  { additionalProperties: false },
);
export type PreviewAutomationTriggerRequest = Static<typeof PreviewAutomationTriggerRequestSchema>;

export const PreviewAutomationTriggerResponseSchema = Type.Object(
  {
    /** ISO date-times; empty for triggers that are not schedules. */
    nextRuns: Type.Array(Type.String(), { maxItems: 5 }),
    problem: Type.Optional(AutomationTriggerProblemSchema),
  },
  { additionalProperties: false },
);
export type PreviewAutomationTriggerResponse = Static<
  typeof PreviewAutomationTriggerResponseSchema
>;

/** PATCH `/v1/automation-settings`: the global pause. */
export const AutomationSettingsSchema = Type.Object(
  { paused: Type.Boolean() },
  { additionalProperties: false },
);
export type AutomationSettings = Static<typeof AutomationSettingsSchema>;
