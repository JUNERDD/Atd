import {
  canonicalJson,
  COMPUTER_MAX_UNRESOLVED,
  isUnresolvedFact,
  type AutomationComputerFacts,
  type Automation,
  type AutomationComputerPolicy,
  type ComputerCondition,
  type ComputerFact,
  type ComputerHold,
  type ComputerRecipeStep,
} from '@atd/agent-contracts';
import type { AutomationComputer } from './computer-deps.js';
import { classify, type Classified, type RunEnd } from './outcome.js';
import type { Settlement } from './records.js';

/**
 * How durable computer facts (decision D4, written by the computer module) decide an automation
 * run's result, its hold and a trial's qualification. Facts win over the task's status and over
 * anything the model said: an action whose effect is unresolved makes the run need attention and
 * holds the automation however the run ended (stopped, failed and timed out included), and a run
 * is delivered only when the host verified the completion condition. A declined count is never
 * used to stand in for any of this.
 */

/** A hold before the service stamps when and for which run (`settleRun`). */
export type HoldFinding = Pick<ComputerHold, 'reason' | 'unresolvedActionIds'>;

export interface ComputerSettlement {
  classified: Classified;
  computer?: AutomationComputerFacts;
  hold?: HoldFinding;
}

const same = (a: ComputerCondition, b: ComputerCondition) => canonicalJson(a) === canonicalJson(b);

/** The recipe steps whose host verification is a verification of `completion`. */
export function completionSteps(policy: AutomationComputerPolicy): ComputerRecipeStep[] {
  return policy.recipe.steps.filter(
    (step) =>
      (step.postcondition !== undefined && same(step.postcondition, policy.completion)) ||
      (step.kind === 'wait' && same(step.condition, policy.completion)),
  );
}

/**
 * Whether the host verified the completion condition: an action of a step that checks it (as its
 * postcondition, or as the condition it waits for) settled `verified`.
 */
export function completionVerified(
  facts: readonly ComputerFact[],
  policy: AutomationComputerPolicy,
): boolean {
  const ids = new Set(completionSteps(policy).map((step) => step.stepId));
  return facts.some(
    (fact) =>
      fact.recipeStepId !== undefined &&
      ids.has(fact.recipeStepId) &&
      fact.result?.effect === 'verified',
  );
}

/**
 * The hold unresolved facts call for, or undefined when every effect is resolved. An action the
 * host stopped for the person's sake needs them to look (`needsHuman`): they were using the target
 * (`targetInUse`), or the action disturbed them (`disturbed`).
 */
export function holdOf(facts: readonly ComputerFact[]): HoldFinding | undefined {
  const unresolved = facts.filter(isUnresolvedFact);
  if (!unresolved.length) return undefined;
  const needsHuman = unresolved.some((fact) => {
    const code = fact.result?.error?.code;
    return code === 'targetInUse' || code === 'disturbed';
  });
  const partialOnly = unresolved.every((fact) => fact.result?.effect === 'partial');
  return {
    reason: needsHuman ? 'needsHuman' : partialOnly ? 'partialEffect' : 'unknownEffect',
    unresolvedActionIds: unresolved.map((fact) => fact.actionId).slice(0, COMPUTER_MAX_UNRESOLVED),
  };
}

/**
 * The result of an automation run with computer facts, from `base` (what the task's end alone
 * says). `policy` is the automation's computer scope, absent when it has none; `facts` is null
 * when the run's records could not be read, which for a computer automation is as unresolved as
 * an unknown effect: nothing proves its actions did not happen.
 */
export function computerSettlement(
  base: Classified,
  facts: readonly ComputerFact[] | null,
  policy: AutomationComputerPolicy | undefined,
  summarize: (facts: readonly ComputerFact[]) => AutomationComputerFacts,
): ComputerSettlement {
  if (facts === null) {
    if (!policy) return { classified: base };
    return {
      classified: {
        ...base,
        outcome: 'needsAttention',
        reason: 'computerUnknownEffect',
        detail:
          "The run's computer records could not be read; check what it did before it acts again.",
      },
      hold: { reason: 'unknownEffect', unresolvedActionIds: [] },
    };
  }
  if (!facts.length && !policy) return { classified: base };
  const computer = summarize(facts);
  const hold = holdOf(facts);
  if (hold) {
    const detail = `${hold.unresolvedActionIds.length} computer action(s) may have taken effect without being verified; review them before the automation acts again.`;
    return {
      classified: {
        ...base,
        outcome: 'needsAttention',
        reason: hold.reason === 'needsHuman' ? 'computerNeedsHuman' : 'computerUnknownEffect',
        detail,
      },
      computer,
      hold,
    };
  }
  if (policy && base.outcome === 'delivered' && !completionVerified(facts, policy))
    return {
      classified: {
        ...base,
        outcome: 'needsAttention',
        reason: 'computerNeedsHuman',
        detail: 'The run ended without the host verifying its completion condition.',
      },
      computer,
    };
  return { classified: base, computer };
}

/**
 * How an automation's ended task run settles: what its end says (outcome.ts `classify`), then
 * what its computer facts say over it. `automation` is absent when it was deleted meanwhile.
 */
export function endedSettlement(
  end: RunEnd,
  automation: Automation | undefined,
  computer: AutomationComputer | undefined,
): Settlement {
  const base = classify(end, automation?.delivery.notify ?? 'always');
  if (!computer) return { ...base, declined: end.declined };
  const summarize = (facts: readonly ComputerFact[]) => computer.summarizeFacts(facts);
  const policy = automation?.policy.computer;
  const { classified, ...facts } = computerSettlement(base, end.facts, policy, summarize);
  return { ...classified, declined: end.declined, ...facts };
}

/**
 * Whether an attended trial qualifies its recipe: it acted, every action belongs to a recipe
 * step, no effect is unresolved, every action with a side effect settled `verified` (one that
 * only read may also settle with no effect), and the completion condition was verified.
 */
export function trialPassed(
  facts: readonly ComputerFact[],
  policy: AutomationComputerPolicy,
): boolean {
  if (!facts.length || holdOf(facts)) return false;
  const stepIds = new Set(policy.recipe.steps.map((step) => step.stepId));
  const settled = facts.every((fact) => {
    if (fact.recipeStepId === undefined || !stepIds.has(fact.recipeStepId)) return false;
    const effect = fact.result?.effect;
    if (fact.effect === 'read') return effect === 'verified' || effect === 'none';
    return effect === 'verified';
  });
  return settled && completionVerified(facts, policy);
}
