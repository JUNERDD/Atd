import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Automation actions (docs/plans/2026-10-06-automations.md): what each run of an automation does.
 * The trigger says when (automation-triggers.ts); the policy and delivery around both live with
 * the automation itself (automations.ts).
 */

/**
 * What a run does: a prompt written for the automation, a saved command with bound values, or
 * consolidating memory. Consolidation is the memory engine's own job, not an agent task: it merges
 * duplicates and rewrites outdated entries with history kept, and only suggests removals, so the
 * person confirms every deletion. It starts no task, so its runs carry no `taskId`, and it
 * ignores the policy's tier, tools, memory switch and folders; it writes nothing while memory
 * learning is paused.
 */
export const AutomationActionSchema = Type.Union([
  Type.Object({ kind: Type.Literal('consolidateMemory') }, { additionalProperties: false }),
  Type.Object(
    { kind: Type.Literal('prompt'), prompt: Type.String({ minLength: 1, maxLength: 20000 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('command'),
      commandId: Identifier,
      /** Values for the command's parameters by key; missing ones take the command's defaults. */
      arguments: Type.Record(
        Type.String(),
        Type.Union([Type.String({ maxLength: 10000 }), Type.Number(), Type.Boolean()]),
      ),
      /**
       * Text for the command's `{{input}}`. A folder trigger hands the files that fired it to
       * `{{files}}`. Commands that read the selection, the clipboard or a screenshot cannot run
       * unattended and are refused when the automation is saved.
       */
      input: Type.String({ maxLength: 20000 }),
    },
    { additionalProperties: false },
  ),
]);
export type AutomationAction = Static<typeof AutomationActionSchema>;
