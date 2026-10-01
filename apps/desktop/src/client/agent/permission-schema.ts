import { Type, type Static } from 'typebox';
import { ConfirmReviewSchema, ShellAllowlistEntrySchema } from '@ai/agent-contracts';
import { Identifier } from './command-schema';

/**
 * Per-task approval tier. `manual` prompts for every guarded action, `auto` reviews each guarded
 * action with a model and prompts only when the review flags it (inside-task-folder file work and
 * web search or fetch need no review), `always` never prompts.
 * `ask_user` questions are not permissions and are shown in every tier.
 */
export const PermissionTierSchema = Type.Union([
  Type.Literal('manual'),
  Type.Literal('auto'),
  Type.Literal('always'),
]);
export type PermissionTier = Static<typeof PermissionTierSchema>;
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'manual';
export const PERMISSION_TIERS: readonly PermissionTier[] = ['manual', 'auto', 'always'];

/** Whether a file operation targets the task's own output folder (`tasks/<id>/output`) or not. */
export const GrantLocationSchema = Type.Union([Type.Literal('inside'), Type.Literal('outside')]);
export type GrantLocation = Static<typeof GrantLocationSchema>;

/**
 * The unit a permission decision applies to. A session grant covers every later action with the
 * same scope in the same task session; shell and command saves are scoped as a whole.
 */
export const GrantScopeSchema = Type.Union([
  Type.Object(
    {
      tool: Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('edit')]),
      location: GrantLocationSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ tool: Type.Literal('bash') }, { additionalProperties: false }),
  Type.Object({ tool: Type.Literal('command') }, { additionalProperties: false }),
  // T6 v1.1 additive: MCP per-operation scope (allow_once/deny only).
  Type.Object({ tool: Type.Literal('mcp') }, { additionalProperties: false }),
  // C1 additive: web search and fetch network calls.
  Type.Object({ tool: Type.Literal('web') }, { additionalProperties: false }),
]);
export type GrantScope = Static<typeof GrantScopeSchema>;

/**
 * How one guarded tool call was resolved. `once` and `session` are user decisions from a prompt,
 * `grant` reused an earlier session grant, `tier` was allowed by the task's tier without a prompt,
 * `reviewed` was allowed by the auto tier's review without a prompt.
 */
export const PermissionOutcomeSchema = Type.Union([
  Type.Literal('once'),
  Type.Literal('session'),
  Type.Literal('grant'),
  Type.Literal('tier'),
  Type.Literal('reviewed'),
  Type.Literal('declined'),
]);
export type PermissionOutcome = Static<typeof PermissionOutcomeSchema>;

/**
 * One decision, appended to the task's Pi session as the `app-permission` custom entry so the
 * transcript shows it after resolution and after reopen, and so session grants survive restarts.
 */
export const PermissionRecordSchema = Type.Object(
  {
    toolCallId: Type.String({ maxLength: 256 }),
    runId: Identifier,
    scope: GrantScopeSchema,
    outcome: PermissionOutcomeSchema,
    at: Type.Number(),
  },
  { additionalProperties: false },
);
export type PermissionRecord = Static<typeof PermissionRecordSchema>;

/** The `ask_user` answer, appended as the `app-question` custom entry next to the tool result. */
export const QuestionRecordSchema = Type.Object(
  {
    toolCallId: Type.String({ maxLength: 256 }),
    runId: Identifier,
    /** `null` when the user skipped the question. */
    answer: Type.Union([Type.String({ maxLength: 10000 }), Type.Null()]),
    at: Type.Number(),
  },
  { additionalProperties: false },
);
export type QuestionRecord = Static<typeof QuestionRecordSchema>;

/**
 * Measured thinking time, appended as the `app-thinking-duration` custom entry so the
 * transcript keeps it after reopen. Keyed by stable thinking block id `t:<timestamp>:<index>`.
 */
export const ThinkingDurationRecordSchema = Type.Object(
  {
    blockId: Type.String({ maxLength: 256 }),
    runId: Identifier,
    durationMs: Type.Integer({ minimum: 0 }),
    at: Type.Number(),
  },
  { additionalProperties: false },
);
export type ThinkingDurationRecord = Static<typeof ThinkingDurationRecordSchema>;

const requestBase = {
  id: Identifier,
  taskId: Identifier,
  runId: Identifier,
  /** The Pi tool call that is blocked on this request; the renderer attaches the prompt to its block. */
  toolCallId: Type.String({ maxLength: 256 }),
  /** T6 additive: service executionId (root:<runId> or child:<runId>:<n>) for subtask display. */
  executionId: Type.Optional(Type.String({ maxLength: 256 })),
};
/**
 * A pending human-in-the-loop request. Confirmations guard a tool call and resolve with a
 * permission decision; inputs come from the `ask_user` tool and resolve with text or a skip.
 * The main process holds every pending request of a run and publishes all of them.
 */
export const PermissionRequestSchema = Type.Union([
  Type.Object(
    {
      ...requestBase,
      kind: Type.Literal('confirmation'),
      scope: GrantScopeSchema,
      /** English fallback title; the renderer labels known scopes through i18n. */
      title: Type.String({ maxLength: 500 }),
      /** The command, path, content or definition diff the user is approving. */
      detail: Type.String({ maxLength: 200000 }),
      /** Bash only: the entry the add-to-allowlist choice adds; absent when none is offered. */
      allowlistEntry: Type.Optional(ShellAllowlistEntrySchema),
      /** Auto tier only: why the model review sent this call to the user (flagged or no verdict). */
      review: Type.Optional(ConfirmReviewSchema),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...requestBase,
      kind: Type.Literal('input'),
      title: Type.String({ maxLength: 4000 }),
      options: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 8 }),
    },
    { additionalProperties: false },
  ),
]);
export type PermissionRequest = Static<typeof PermissionRequestSchema>;
export type ConfirmationRequest = Extract<PermissionRequest, { kind: 'confirmation' }>;
export type InputRequest = Extract<PermissionRequest, { kind: 'input' }>;

/** The renderer's reply to a request; the runtime rejects a reply whose shape does not fit the kind. */
export const PermissionAnswerSchema = Type.Union([
  Type.Object(
    {
      decision: Type.Union([
        Type.Literal('once'),
        Type.Literal('session'),
        Type.Literal('declined'),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { answer: Type.String({ minLength: 1, maxLength: 10000 }) },
    {
      additionalProperties: false,
    },
  ),
  Type.Object({ skipped: Type.Literal(true) }, { additionalProperties: false }),
]);
export type PermissionAnswer = Static<typeof PermissionAnswerSchema>;
