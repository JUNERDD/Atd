import { Type, type Static } from 'typebox';
import { AutomationTimeOfDaySchema, AutomationWeekdaySchema } from './automation-triggers.js';
import { Identifier } from './identifiers.js';

/**
 * Suggested next steps: after a conversation's last run completes normally, one separate,
 * tool-free completion proposes what the person might do next. They belong to that run only; a
 * new run withdraws them, and earlier turns never keep any.
 */

/**
 * Where a suggestion leads: a follow-up in this conversation, a new conversation of its own, or
 * recurring work worth saving as an automation.
 */
export const NextStepKindSchema = Type.Union([
  Type.Literal('continue'),
  Type.Literal('newTask'),
  Type.Literal('automation'),
]);
export type NextStepKind = Static<typeof NextStepKindSchema>;

/** At most this many suggestions per run, and at most two of them follow-ups. */
export const MAX_NEXT_STEPS = 4;
export const MAX_NEXT_STEP_FOLLOW_UPS = 2;

export const NextStepSchema = Type.Object(
  {
    id: Identifier,
    kind: NextStepKindSchema,
    /** The short summary the card shows. */
    label: Type.String({ minLength: 1, maxLength: 80 }),
    /**
     * The complete prompt: what a follow-up puts in the composer, a new task's first message, or
     * the automation's instructions.
     */
    prompt: Type.String({ minLength: 1, maxLength: 4000 }),
    /** Why it is suggested, in one short line. */
    reason: Type.String({ maxLength: 160 }),
    /**
     * An automation's proposed weekly schedule on the Mac's clock: cron weekdays (0 is Sunday) and
     * a time of day. Present only on `automation`, and only a proposal the person edits.
     */
    schedule: Type.Optional(
      Type.Object(
        {
          days: Type.Array(AutomationWeekdaySchema, {
            minItems: 1,
            maxItems: 7,
            uniqueItems: true,
          }),
          time: AutomationTimeOfDaySchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type NextStep = Static<typeof NextStepSchema>;

/**
 * Suggestions for `runId`, which was the task's last run. `pending` is saved in the same write
 * that completes the run, so the turn's action bar keeps a place for them from its first frame;
 * `ready` replaces it with the results, and a failed or empty generation removes it.
 */
export const TaskNextStepsSchema = Type.Union([
  Type.Object(
    { runId: Identifier, status: Type.Literal('pending') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      runId: Identifier,
      status: Type.Literal('ready'),
      items: Type.Array(NextStepSchema, { minItems: 1, maxItems: MAX_NEXT_STEPS }),
    },
    { additionalProperties: false },
  ),
]);
export type TaskNextSteps = Static<typeof TaskNextStepsSchema>;

/**
 * What a click on a follow-up does: put its prompt in the composer for the person to send, or send
 * it at once. An automation is always created from its confirmation dialog.
 */
export const NextStepClickSchema = Type.Union([Type.Literal('fill'), Type.Literal('send')]);
export type NextStepClick = Static<typeof NextStepClickSchema>;

/** Suggestions are on by default; a click fills the composer by default. */
export const DEFAULT_NEXT_STEPS = true;
export const DEFAULT_NEXT_STEP_CLICK: NextStepClick = 'fill';
