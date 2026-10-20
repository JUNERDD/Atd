import { Type, type Static } from 'typebox';
import {
  ComputerActionIdSchema,
  ComputerEffectSchema,
  ComputerHashSchema,
  ComputerRefIdSchema,
  ComputerStepIdSchema,
} from './computer-actions.js';
import { ComputerGrantRefSchema } from './computer-grants.js';
import { ComputerConditionSchema } from './computer-locators.js';
import { ActionResultSchema, ComputerActionPhaseSchema } from './computer-results.js';
import { Identifier } from './identifiers.js';

/**
 * The service's durable fact about one action (JSONL under `<dataDir>/computer/records/`, a
 * protected write root). The run's task status and the action's state are separate: a stopped or
 * failed run still reports the actions it completed. `intentHash` hashes the action as approved.
 * `verification` keeps the approved condition and surface so later checks cannot substitute proof.
 * Older records lack it and require a person to resolve an unknown effect.
 * `resolution` records that an unresolved outcome was settled afterwards: `verified` by a later
 * action of the run (`by`), or checked by a `person`. The latest record per action wins.
 */
export const ComputerFactSchema = Type.Object(
  {
    actionId: ComputerActionIdSchema,
    runId: Identifier,
    taskId: Identifier,
    automationRunId: Type.Optional(Identifier),
    recipeStepId: Type.Optional(ComputerStepIdSchema),
    bindingId: Identifier,
    effect: ComputerEffectSchema,
    phase: ComputerActionPhaseSchema,
    result: Type.Optional(ActionResultSchema),
    intentHash: ComputerHashSchema,
    verification: Type.Optional(
      Type.Object(
        {
          condition: ComputerConditionSchema,
          surfaceRefId: Type.Optional(ComputerRefIdSchema),
        },
        { additionalProperties: false },
      ),
    ),
    grantRef: Type.Optional(ComputerGrantRefSchema),
    resolution: Type.Optional(
      Type.Object(
        {
          kind: Type.Union([Type.Literal('verified'), Type.Literal('person')]),
          by: Type.Optional(ComputerActionIdSchema),
          at: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    at: Type.String(),
  },
  { additionalProperties: false },
);
export type ComputerFact = Static<typeof ComputerFactSchema>;

/**
 * Whether a fact leaves its side effect unresolved: settled with a `partial` or `unknown` effect,
 * or without a result past `intent` — the service records the intent before it sends the action,
 * so a lost reply means the host may have dispatched it. A `read` that never got a result changed
 * nothing. A fact with a `resolution` is resolved whatever its result; callers judge the latest
 * record per action. Such a fact makes an automation run need attention and sets its hold.
 */
export function isUnresolvedFact(fact: ComputerFact): boolean {
  if (fact.resolution !== undefined) return false;
  if (fact.result === undefined) return fact.phase === 'dispatched' || fact.effect !== 'read';
  return fact.result?.effect === 'partial' || fact.result?.effect === 'unknown';
}
