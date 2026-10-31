import { Type, type Static } from 'typebox';
import { AppIdSchema } from './app-identity.js';
import { MAX_ATTACHMENTS } from './attachments.js';
import type { CommandTool } from './commands.js';
import { RunComputerSchema } from './computer-grants.js';
import { Identifier, OperationId, SessionEntryId } from './identifiers.js';
import { PermissionTierSchema } from './confirms.js';
import { MAX_FOLDERS } from './folders.js';
import { MessageUsageSchema } from './message-usage.js';
import { TaskNextStepsSchema } from './next-steps.js';
import { InputChipRangeSchema, MAX_INPUT_CHIPS } from './input-chips.js';
import { RunTriggerSchema } from './run-trigger.js';
import { ThinkingLevelSchema } from './models.js';

/**
 * Snapshot tool ids: frozen per run, granted by roles and inherited by subagent children within
 * the role ceiling. `ask_user` stays accepted for runs frozen before it moved to the parent-only
 * service tools. Harness tools (todo, web, memory) are named in tool-names.ts and never
 * appear here. C1 additive: `grep`, `find`, `ls` (read-only, task-folder confined).
 */
export const ServiceToolIdSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
  Type.Literal('ask_user'),
  Type.Literal('grep'),
  Type.Literal('find'),
  Type.Literal('ls'),
]);
export type ServiceToolId = Static<typeof ServiceToolIdSchema>;

/**
 * The snapshot tools a five-tool grant stands for (commands, skills, roles and the desktop run
 * policy name only those five): `read` also grants the read-only search tools, which share its
 * task-folder confinement. Order follows the grant, then the search tools.
 */
export function snapshotToolsFor(tools: readonly CommandTool[]): ServiceToolId[] {
  return tools.includes('read') ? [...tools, 'grep', 'find', 'ls'] : [...tools];
}

/** What a run gets when neither the request nor an earlier run of its task chose tools. */
export const DEFAULT_RUN_TOOLS: readonly ServiceToolId[] = snapshotToolsFor([
  'read',
  'write',
  'edit',
  'bash',
  'command',
]);

export const FileRefSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ maxLength: 255 }),
    size: Type.Integer({ minimum: 0 }),
    type: Type.String({ maxLength: 100 }),
  },
  { additionalProperties: false },
);
export type FileRef = Static<typeof FileRefSchema>;

export const TaskInputSchema = Type.Object(
  {
    text: Type.String({ maxLength: 100000 }),
    source: Type.Union([
      Type.Literal('manual'),
      Type.Literal('selection'),
      Type.Literal('clipboard'),
      Type.Literal('screenshot'),
      Type.Literal('none'),
    ]),
    capturedAt: Type.String(),
    selection: Type.String({ maxLength: 100000 }),
    clipboard: Type.String({ maxLength: 100000 }),
    files: Type.Array(FileRefSchema, { maxItems: MAX_ATTACHMENTS }),
    arguments: Type.Record(
      Type.String(),
      Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean()]),
    ),
    /**
     * Composer chips in `text`, in document order. The desktop always sends the array, empty for
     * plain text, so an absent field marks input from before chips were recorded (or from another
     * client): the transcript then reads a leading `/skill:<name> ` as the skill chip it was.
     */
    chips: Type.Optional(Type.Array(InputChipRangeSchema, { maxItems: MAX_INPUT_CHIPS })),
    /**
     * Ids of folders from `/v1/folders/register` this message grants to its task. The desktop
     * always sends the array; an absent field marks input from before folders. The service grants
     * them at submit and rejects the submit when an id is unknown.
     */
    folders: Type.Optional(Type.Array(Identifier, { maxItems: MAX_FOLDERS })),
  },
  { additionalProperties: false },
);
export type TaskInput = Static<typeof TaskInputSchema>;

/**
 * Frozen model reference; temp-credential injection resolves auth at run time.
 * T2 additive growth: provider accepts any Pi provider id so migrated runs
 * keep their original provider (T1 wrote openai/openai-compatible only);
 * configurationId pins the connection revision the run was accepted with.
 */
export const ServiceModelSchema = Type.Object(
  {
    connectionId: Type.String({ maxLength: 4096 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
    provider: Type.String({ minLength: 1, maxLength: 256 }),
    baseUrl: Type.String({ maxLength: 2048 }),
    configurationId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);
export type ServiceModel = Static<typeof ServiceModelSchema>;

export const ModelSelectionSchema = Type.Object(
  {
    connectionId: Type.String({ minLength: 1, maxLength: 4096 }),
    modelId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export type ModelSelection = Static<typeof ModelSelectionSchema>;

/** Run lifecycle; `unknown` means the outcome could not be established. */
export const RunStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('awaiting_input'),
  Type.Literal('awaiting_confirmation'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
  Type.Literal('interrupted'),
  Type.Literal('unknown'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

/** Frozen at acceptance; later config edits never mutate an accepted snapshot. */
export const RunSnapshotSchema = Type.Object(
  {
    input: TaskInputSchema,
    instructions: Type.String({ maxLength: 20000 }),
    model: ServiceModelSchema,
    tools: Type.Array(ServiceToolIdSchema),
    memory: Type.Boolean(),
    /** T2 additive: migrated runs keep their accepted thinking level. */
    thinkingLevel: Type.Optional(ThinkingLevelSchema),
    /**
     * Effective context window in tokens, frozen at acceptance from the connection's tier for the
     * model; later tier changes never affect the run. Absent (runs accepted before tiers existed)
     * means the model catalog's window.
     */
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    /**
     * The user message entry this run's prompt replaces (edit and resend, regenerate): before
     * prompting, the session branch moves to just before that entry, so the replaced message and
     * everything after it leave the transcript while staying in the session file.
     */
    branchBefore: Type.Optional(SessionEntryId),
    /**
     * The run's prompt is command material, never the user's own words: a saved command's
     * rendered template (`SubmitTaskRequest.fromCommand`), or a replacement of such a run's prompt
     * (edit and resend, regenerate). Memory's automatic learners never read the run; it still
     * searches memory and keeps the memory tools.
     */
    fromCommand: Type.Optional(Type.Literal(true)),
    /** Set when an automation started the run, which makes it unattended (`RunTriggerSchema`). */
    trigger: Type.Optional(RunTriggerSchema),
    /**
     * Service-owned inference purpose, frozen for app and automation runs. Consent itself is
     * checked live for every request. Absent on older runs; user follow-ups freeze false.
     */
    background: Type.Optional(Type.Boolean()),
    /**
     * The run executes on the lightweight path: a session with no tools, skills, MCP servers,
     * subagents or memory wiring and a short system prompt. Only the service sets it, for a saved
     * command's first run in a new task that needs none of those; follow-ups never carry it.
     */
    lite: Type.Optional(Type.Literal(true)),
    /**
     * Computer use the run may perform (`RunComputerSchema`): absent means no `computer` tool.
     * Frozen at acceptance from the submit or command launch; an unattended run's also carries
     * the grant it was enqueued under, which a follow-up never inherits.
     */
    computer: Type.Optional(RunComputerSchema),
  },
  { additionalProperties: false },
);
export type RunSnapshot = Static<typeof RunSnapshotSchema>;

/**
 * A task the user did not start: a user app's backend started it through `ctx.agent.run`, or an
 * automation fired. History shows the app or automation on it; an app task's confirms still go
 * through the task panel, while an automation's runs are unattended (`RunSnapshot.trigger`).
 */
export const TaskOriginSchema = Type.Union([
  Type.Object({ kind: Type.Literal('app'), appId: AppIdSchema }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('automation'), automationId: Identifier },
    { additionalProperties: false },
  ),
]);
export type TaskOrigin = Static<typeof TaskOriginSchema>;

export const TaskRunSchema = Type.Object(
  {
    id: Identifier,
    operationId: OperationId,
    createdAt: Type.String(),
    status: RunStatusSchema,
    error: Type.String(),
    snapshot: RunSnapshotSchema,
    /**
     * What the request for this run's suggested next steps used (`next-steps.ts`), added once it
     * answers. It stays when a later run withdraws the suggestions, since it was spent either way.
     */
    nextStepsUsage: Type.Optional(MessageUsageSchema),
  },
  { additionalProperties: false },
);
export type TaskRun = Static<typeof TaskRunSchema>;

export const AgentTaskSchema = Type.Object(
  {
    id: Identifier,
    title: Type.String(),
    /** The initial summary is being generated; absence means the saved title is settled. */
    titleGeneration: Type.Optional(Type.Literal('pending')),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    sessionFile: Type.Union([Type.String(), Type.Null()]),
    runs: Type.Array(TaskRunSchema),
    /** T5 owns subagent linkage; T1 always records root tasks. */
    rootTaskId: Type.Union([Identifier, Type.Null()]),
    parentExecutionId: Type.Union([Type.String({ maxLength: 256 }), Type.Null()]),
    /** Frozen from the service default when the task is created. */
    permissionTier: Type.Optional(PermissionTierSchema),
    /** Who started the task; absent for a task the user started (every task before apps). */
    origin: Type.Optional(TaskOriginSchema),
    /**
     * The conversation this task is a side chat of: a command launched from inside that
     * conversation ran here, and the conversation lists it above its composer. Set when the task
     * is created and never changed. A side chat outlives its conversation, so the id may name a
     * deleted task.
     */
    sideChatOf: Type.Optional(Identifier),
    /** The person pinned the task to the top of their task list; absent when it is not pinned. */
    pinned: Type.Optional(Type.Literal(true)),
    /** Suggested next steps for the last run, once generated (`next-steps.ts`). */
    nextSteps: Type.Optional(TaskNextStepsSchema),
  },
  { additionalProperties: false },
);
export type AgentTask = Static<typeof AgentTaskSchema>;

/** Active statuses that block acceptance of a second run on the same task. */
export function isActiveStatus(status: RunStatus | undefined): boolean {
  return (
    status !== undefined &&
    ['queued', 'running', 'awaiting_input', 'awaiting_confirmation', 'stopping'].includes(status)
  );
}

/**
 * Terminal statuses after which the run's status and snapshot never change again; only usage
 * metadata such as `nextStepsUsage` may still be added.
 */
export function isTerminalStatus(status: RunStatus | undefined): boolean {
  return (
    status !== undefined &&
    ['stopped', 'completed', 'failed', 'cancelled', 'interrupted', 'unknown'].includes(status)
  );
}
