import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * What made an automation fire: its schedule, a change in its watched folder, the Mac becoming
 * idle, another automation's result, or a person pressing Run now.
 */
export const AutomationFireSourceSchema = Type.Union([
  Type.Literal('schedule'),
  Type.Literal('folder'),
  Type.Literal('idle'),
  Type.Literal('automation'),
  Type.Literal('manual'),
]);
export type AutomationFireSource = Static<typeof AutomationFireSourceSchema>;

/**
 * Why a run started without a prompt from the person in the panel, frozen onto the run at
 * acceptance (`RunSnapshot.trigger`). Its presence makes the run unattended: nobody is there to
 * answer, so a guarded action the task's tier would ask about is declined at once, `ask_user`
 * gets an answer that nobody is available, desktop actions and MCP configuration are unavailable,
 * and memory never learns from the run. Only service code sets it; the HTTP submit cannot.
 */
export const RunTriggerSchema = Type.Object(
  {
    kind: Type.Literal('automation'),
    automationId: Identifier,
    /** The automation's run record (`AutomationRun.id`) this task run carries out. */
    automationRunId: Identifier,
    source: AutomationFireSourceSchema,
    firedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type RunTrigger = Static<typeof RunTriggerSchema>;
