import {
  recipeStepEffect,
  type ComputerAction,
  type ComputerActionInput,
  type ComputerEffect,
  type ComputerFact,
  type ComputerRecipe,
  type ComputerRecipeStep,
  type ComputerStep,
  type ComputerTextConstraint,
  type TargetBinding,
} from '@atd/agent-contracts';
import { originAllowed } from './bindings.js';

/** How long a recipe step's precondition may take to hold before the step is not dispatched. */
const PRECONDITION_WAIT_MS = 10_000;

/** Why the scope check refused a call, in English for the model; the caller audits it. */
export type Refusal = { ok: false; message: string };

export interface RecipeAction {
  ok: true;
  action: ComputerAction;
  effect: ComputerEffect;
  stepId: string;
}

function refuse(message: string): Refusal {
  return { ok: false, message };
}

/**
 * The recipe steps a run may carry out next: the first step before anything dispatched, then the
 * branches (`next`) of the last step that may have dispatched. A step that was never dispatched
 * does not move the position, so it may be tried again.
 */
export function allowedNextSteps(recipe: ComputerRecipe, facts: readonly ComputerFact[]): string[] {
  const done = facts.filter(
    (fact) => fact.recipeStepId !== undefined && fact.result?.dispatch !== 'not_dispatched',
  );
  const last = done.at(-1)?.recipeStepId;
  if (last === undefined) return recipe.steps[0] ? [recipe.steps[0].stepId] : [];
  return recipe.steps.find((step) => step.stepId === last)?.next ?? [];
}

/**
 * Builds the action a recipe-bound run sends for one model call: exactly one step of the kind
 * the named recipe step allows, with the recipe's locator, condition, effect and postcondition,
 * and only the model's parameters the step leaves open (a URL under its prefix, text within its
 * constraint, a scroll direction and amount). The recipe's precondition runs first as a `wait`.
 */
export function recipeAction(
  recipe: ComputerRecipe,
  input: ComputerActionInput,
  actionId: string,
  binding: TargetBinding,
  facts: readonly ComputerFact[],
): RecipeAction | Refusal {
  const { recipeStepId } = input;
  if (!recipeStepId) return refuse('This run may only carry out steps of its recipe: name one.');
  const step = recipe.steps.find((item) => item.stepId === recipeStepId);
  if (!step) return refuse(`The recipe has no step ${recipeStepId}.`);
  if (step.bindingId !== binding.bindingId)
    return refuse(`Recipe step ${recipeStepId} acts on another target.`);
  const allowed = allowedNextSteps(recipe, facts);
  if (!allowed.includes(recipeStepId))
    return refuse(
      `Recipe step ${recipeStepId} cannot run now; allowed next: ${allowed.join(', ') || 'none'}.`,
    );
  const [given, ...extra] = input.steps;
  if (!given || extra.length || given.kind !== step.kind)
    return refuse(`Recipe step ${recipeStepId} takes exactly one ${step.kind} step.`);
  const built = authoritativeStep(step, given, binding);
  if (!built.ok) return built;
  const steps: ComputerStep[] = step.precondition
    ? [{ kind: 'wait', condition: step.precondition, timeoutMs: PRECONDITION_WAIT_MS }, built.step]
    : [built.step];
  const action: ComputerAction = {
    actionId,
    targetRefId: input.targetRefId,
    observationRefId: input.observationRefId,
    steps,
    recipeStepId,
    ...(step.postcondition ? { postcondition: step.postcondition } : {}),
  };
  return { ok: true, action, effect: recipeStepEffect(step), stepId: recipeStepId };
}

/**
 * The step the recipe allows, filled with the model's open parameters once they pass. Every
 * recipe step kind has its case, so a kind added to recipes later fails to compile here until it
 * is decided; the steps recipes do not carry (click, key, type, clear, menu, drag) never reach
 * this function, since the given step must have the recipe step's kind.
 */
function authoritativeStep(
  step: ComputerRecipeStep,
  given: ComputerStep,
  binding: TargetBinding,
): { ok: true; step: ComputerStep } | Refusal {
  const mismatch = refuse(`Recipe step ${step.stepId} takes a ${step.kind} step.`);
  switch (step.kind) {
    case 'navigate': {
      if (given.kind !== 'navigate') return mismatch;
      if (!given.url.startsWith(step.urlPrefix) || !originAllowed(binding, given.url))
        return refuse('That address is outside what the recipe step allows.');
      return { ok: true, step: { kind: 'navigate', url: given.url } };
    }
    case 'fill':
    case 'setValue': {
      if (given.kind !== step.kind) return mismatch;
      const fits = textFits(step.text, given.text);
      if (!fits.ok) return fits;
      return { ok: true, step: { kind: step.kind, locator: step.locator, text: given.text } };
    }
    case 'press':
      return { ok: true, step: { kind: 'press', locator: step.locator, effect: step.effect } };
    case 'scroll': {
      if (given.kind !== 'scroll') return mismatch;
      // The direction and amount are the model's; a capture point never enters a recipe step.
      const { direction, amount } = given;
      return {
        ok: true,
        step: {
          kind: 'scroll',
          direction,
          amount,
          ...(step.locator ? { locator: step.locator } : {}),
        },
      };
    }
    case 'wait':
      return {
        ok: true,
        step: { kind: 'wait', condition: step.condition, timeoutMs: step.timeoutMs },
      };
  }
}

/** Whether text satisfies a recipe step's constraint; never echoes the text itself. */
function textFits(constraint: ComputerTextConstraint, text: string): { ok: true } | Refusal {
  if (text.length > constraint.maxLength)
    return refuse(
      `The text is longer than the ${constraint.maxLength} characters the step allows.`,
    );
  if (constraint.oneOf && !constraint.oneOf.includes(text))
    return refuse('The text is not one of the values the step allows.');
  if (constraint.pattern !== undefined) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(`^(?:${constraint.pattern})$`, 'u');
    } catch {
      return refuse("The recipe step's text pattern is not valid.");
    }
    if (!pattern.test(text)) return refuse("The text does not match the step's pattern.");
  }
  return { ok: true };
}
