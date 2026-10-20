import {
  COMPUTER_STEP_KINDS_FOR_KIND,
  type AutomationComputerPolicy,
  type AutomationDraft,
  type ComputerRecipeStep,
  type TargetBinding,
} from '@atd/agent-contracts';
import type { ComputerBindingSource } from './computer-deps.js';
import { completionSteps } from './computer-outcome.js';

/**
 * What a saved computer scope must satisfy beyond its schema (plan §7.3): only a prompt or command
 * may act on the computer, every binding is registered, each step acts on one of the policy's
 * bindings with a step kind that target supports, a navigation stays inside the binding's origins,
 * step ids are unique and every branch names a step, the steps never loop, and some step lets the
 * host verify the completion condition, since only that verification makes a run delivered.
 * Recipe steps keep their own closed kinds (`ComputerRecipeStepSchema`): the pointer, key, typing,
 * clearing, menu and drag steps of attended runs and their capture points never enter a recipe, so
 * no unattended run carries an `invoke` effect.
 */

function invalid(text: string): TypeError {
  return new TypeError(`Invalid automation: ${text}`);
}

/** Whether `url` lies inside one of the binding's allowed origins. */
function withinOrigins(url: string, binding: TargetBinding): boolean {
  if (binding.kind !== 'browser') return false;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  return binding.allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase());
}

function checkStep(
  step: ComputerRecipeStep,
  policy: AutomationComputerPolicy,
  bindings: ComputerBindingSource,
): void {
  if (!policy.bindingIds.includes(step.bindingId))
    throw invalid(`recipe step "${step.stepId}" acts on a target the automation does not name.`);
  const binding = bindings.get(step.bindingId);
  if (!binding) throw invalid(`the computer target of step "${step.stepId}" is not registered.`);
  if (!COMPUTER_STEP_KINDS_FOR_KIND[binding.kind].includes(step.kind))
    throw invalid(
      `recipe step "${step.stepId}" (${step.kind}) cannot act on a ${binding.kind} target.`,
    );
  if (step.kind === 'navigate' && !withinOrigins(step.urlPrefix, binding))
    throw invalid(`recipe step "${step.stepId}" navigates outside the target's allowed sites.`);
}

/** Whether following `next` from any step can come back to it. */
function hasLoop(steps: readonly ComputerRecipeStep[]): boolean {
  const next = new Map(steps.map((step) => [step.stepId, step.next]));
  const state = new Map<string, 'open' | 'done'>();
  const visit = (id: string): boolean => {
    const seen = state.get(id);
    if (seen === 'open') return true;
    if (seen === 'done') return false;
    state.set(id, 'open');
    const looped = (next.get(id) ?? []).some(visit);
    state.set(id, 'done');
    return looped;
  };
  return steps.some((step) => visit(step.stepId));
}

/**
 * Refuses a draft whose computer scope cannot be saved; `bindings` is absent when the service
 * runs without computer use, which then refuses every computer scope.
 */
export function checkComputerDraft(
  draft: AutomationDraft,
  bindings: ComputerBindingSource | undefined,
): void {
  const policy = draft.policy.computer;
  if (!policy) return;
  if (draft.action.kind === 'consolidateMemory')
    throw invalid('a memory consolidation cannot act on the computer.');
  if (!bindings) throw invalid('computer use is not available in this version of Atd.');
  for (const id of policy.bindingIds)
    if (!bindings.get(id)) throw invalid('a computer target it names is not registered.');
  const { steps } = policy.recipe;
  const ids = new Set(steps.map((step) => step.stepId));
  if (ids.size !== steps.length) throw invalid('two recipe steps share an id.');
  for (const step of steps) {
    checkStep(step, policy, bindings);
    for (const id of step.next)
      if (!ids.has(id)) throw invalid(`recipe step "${step.stepId}" continues to an unknown step.`);
  }
  if (hasLoop(steps)) throw invalid('the recipe steps loop; every path must come to an end.');
  if (!completionSteps(policy).length)
    throw invalid(
      'no recipe step checks the completion condition, as its postcondition or as a wait.',
    );
}
