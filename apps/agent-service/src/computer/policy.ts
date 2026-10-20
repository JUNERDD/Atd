import {
  COMPUTER_EFFECT_RANK,
  isBusinessEffect,
  isUnresolvedFact,
  isVisualStep,
  stepEffect,
  type CapabilityProfile,
  type ComputerAction,
  type ComputerActionInput,
  type ComputerEffect,
  type ComputerFact,
  type ComputerGrantRef,
  type ComputerRecipe,
  type ComputerVisualState,
  type RunComputer,
  type TargetBinding,
  type TargetRef,
} from '@atd/agent-contracts';
import type { ComputerBindingStore } from './bindings.js';
import type { KnownCapture } from './captures.js';
import type { ComputerGrantCheck } from './grant-check.js';
import { recipeAction, type Refusal } from './recipe-step.js';
import { regionalConditionsProblem } from './regional-conditions.js';
import { stepsAllowed } from './step-checks.js';
import { resolutionProblem } from './resolve.js';

/*
 * The hard computer scope check (D5, D10): runs before the approval gate on every call, and no
 * tier, session grant or review can skip it. A refusal names why in English for the model; the
 * caller audits it.
 */

/** How a run may act: freely within its bindings (attended), or only through a frozen recipe. */
export type RunScope =
  | { ok: true; mode: 'free' }
  | {
      ok: true;
      mode: 'grant' | 'trial';
      recipe: ComputerRecipe;
      maxSubmits: number;
      grantRef?: ComputerGrantRef;
    };

function refuse(message: string): Refusal {
  return { ok: false, message };
}

/**
 * The scope the current run acts in. A run with a grant or a trial is recipe-bound and checked
 * live against the automation (`ComputerGrantCheck`) and the bindings it froze; an unattended run
 * without a grant may not use the computer at all.
 */
export function runScope(
  computer: RunComputer,
  unattended: boolean,
  grants: ComputerGrantCheck,
  bindings: ComputerBindingStore,
): RunScope | Refusal {
  const { grant, trial } = computer;
  if (grant) {
    const verdict = grants.check(grant);
    if (!verdict.ok) return refuse(`The automation's computer authorization is ${verdict.reason}.`);
    for (const [bindingId, hash] of Object.entries(grant.bindingHashes))
      if (!bindings.matches(bindingId, hash))
        return refuse('A target the automation was authorized for changed or was removed.');
    const grantRef = { grantId: grant.grantId, version: grant.version };
    return {
      ok: true,
      mode: 'grant',
      recipe: verdict.recipe,
      maxSubmits: verdict.maxSubmits,
      grantRef,
    };
  }
  if (unattended)
    return refuse('Computer use in an automation run needs an authorized recipe; none applies.');
  if (trial) {
    const verdict = grants.trial(trial);
    if (!verdict.ok) return refuse(`The trial's automation is ${verdict.reason}.`);
    for (const [bindingId, hash] of Object.entries(trial.bindingHashes))
      if (!bindings.matches(bindingId, hash))
        return refuse('A target of the trial changed or was removed.');
    return { ok: true, mode: 'trial', recipe: verdict.recipe, maxSubmits: verdict.maxSubmits };
  }
  return { ok: true, mode: 'free' };
}

/** The live binding a run may name: one of its frozen bindings that is still registered. */
export function runBinding(
  computer: RunComputer,
  bindingId: string,
  bindings: ComputerBindingStore,
): TargetBinding | Refusal {
  if (!computer.bindingIds.includes(bindingId))
    return refuse('That target is not one this run may use.');
  return bindings.get(bindingId) ?? refuse('That target was removed.');
}

/** What an allowed action is: the action to send, its gated effect, the recipe step it runs. */
export interface AllowedAction {
  ok: true;
  action: ComputerAction;
  /** The highest effect of its steps; the recipe's in a recipe-bound run. */
  effect: ComputerEffect;
  recipeStepId?: string;
  /** Earlier actions a `verified` result of this read-only action resolves (A2). */
  resolves?: readonly string[];
  /** Visual steps allowed only by the development override, which the caller audits. */
  visualOverride?: true;
}

export interface ActCheck {
  scope: RunScope;
  unattended: boolean;
  binding: TargetBinding;
  targetRef: TargetRef;
  /** The bound host's profile for the binding's engine; absent when it published none. */
  profile: CapabilityProfile | undefined;
  /** The run's facts so far, latest per action. */
  facts: readonly ComputerFact[];
  /** Unresolved facts of the task (any of its runs) on this binding (A3, plan §5.2 item 6). */
  taskUnresolved: readonly ComputerFact[];
  /** The run model's visual state, and whether the development override holds. */
  visual: ComputerVisualState;
  visualOverride: boolean;
  /** A capture the run observed of this target ref. */
  capture: (captureId: string) => KnownCapture | undefined;
}

/**
 * Checks one `act` against the run's scope and returns the action as the host receives it. In a
 * recipe-bound run the action must carry out an allowed next step of the recipe, and the
 * service, not the model, fills in its locator, condition, effect and postcondition; such a run
 * never takes visual steps or carries `invoke`. In a free run a new business action (`invoke`,
 * `submit`) waits until every unresolved business action of the task on the binding was resolved;
 * reads and other writes stay allowed. Every action runs in the background: the host picks each
 * step's route and refuses a step that has none (`noBackgroundRoute`), so nothing here chooses a
 * delivery. Visual steps (capture points) need the run's model qualified for them, which no
 * recorded qualification is yet (visual-qualifications.ts), unless the development override holds.
 */
export function checkAct(
  check: ActCheck,
  input: ComputerActionInput,
  actionId: string,
): AllowedAction | Refusal {
  const { scope, binding, profile } = check;
  const inputRegionProblem = regionalConditionsProblem(input, check);
  if (inputRegionProblem) return refuse(inputRegionProblem);
  if (!profile) return refuse('The computer host offers no engine for this target.');
  if (check.unattended && (profile.qualification !== 'qualified' || profile.affectsSystemInput))
    return refuse('The engine for this target is not qualified for unattended use.');
  const built =
    scope.mode === 'free'
      ? freeAction(check, input, actionId)
      : recipeBound(check, scope, input, actionId);
  if (!built.ok) return built;
  const { action } = built;
  const regionalProblem = regionalConditionsProblem(action, check);
  if (regionalProblem) return refuse(regionalProblem);
  // A visual step of a model that is not qualified runs only under the development override.
  const overridden = action.steps.some(isVisualStep) && check.visual !== 'qualified';
  if (overridden && (!check.visualOverride || check.visual !== 'unverified'))
    return refuse(visualRefusal(check.visual));
  const steps = stepsAllowed(action, {
    binding,
    profile,
    targetRef: check.targetRef,
    capture: check.capture,
  });
  if (!steps.ok) return steps;
  return { ...built, ...(overridden ? { visualOverride: true } : {}) };
}

function visualRefusal(state: ComputerVisualState): string {
  return state === 'unavailable'
    ? 'notQualified: the model of this run takes no images, so it cannot act on capture points. Nothing was sent. Use element refs or semantic locators.'
    : 'notQualified: this model is not qualified for capture-point steps in the background. Nothing was sent. Use element refs or semantic locators from the observation; if the control has neither, ask the person to do this step.';
}

type Built = Omit<AllowedAction, 'visualOverride'>;

/**
 * A free run's action: the model's own, behind the task's unresolved business gate (plan §5.2
 * item 6). Only a business effect waits, and only on an unresolved business effect: a `submit` or
 * `invoke` whose outcome nobody confirmed must not be followed by another one on the same target
 * (that could commit twice), while navigating, reading and editing fields stay as free as an
 * attended run always was. `resolves` lets a read-only action with a postcondition settle earlier
 * unresolved actions of the task on the binding when the host reports it `verified`.
 */
function freeAction(
  check: ActCheck,
  input: ComputerActionInput,
  actionId: string,
): Built | Refusal {
  const { resolves, ...rest } = input;
  const action: ComputerAction = { ...rest, actionId };
  const effect = highestEffect(action);
  const conditions = [
    ...action.steps.flatMap((step) => (step.kind === 'wait' ? [step.condition] : [])),
    ...(action.postcondition ? [action.postcondition] : []),
  ];
  if (
    check.binding.kind !== 'native' &&
    conditions.some((condition) => condition.kind === 'menuItemAvailable')
  )
    return refuse('menuItemAvailable reads native application menus only; nothing was sent.');
  if (isBusinessEffect(effect) && !action.postcondition)
    return refuse(
      'A submit or invoke (including a screenshot click) needs a postcondition before input is sent. Choose an observable result, such as new text, a changed value or URL, and include a short wait when the UI needs time. No input was sent.',
    );
  if (resolves) {
    if (effect !== 'read' || !action.postcondition)
      return refuse('resolves needs an action of read-only steps with a postcondition.');
    const open = new Set(check.taskUnresolved.map((fact) => fact.actionId));
    const foreign = resolves.filter((id) => !open.has(id));
    if (foreign.length)
      return refuse(`Not unresolved actions of this task on this target: ${foreign.join(', ')}.`);
    const verification = {
      condition: action.postcondition,
      ...(action.surfaceRefId ? { surfaceRefId: action.surfaceRefId } : {}),
    };
    for (const fact of check.taskUnresolved.filter((item) => resolves.includes(item.actionId))) {
      const problem = resolutionProblem(fact, verification);
      if (problem) return refuse(problem);
    }
  }
  if (isBusinessEffect(effect)) {
    // The intent covers every planned step. The host's retry contract distinguishes a
    // dispatched business step (`never`) from preparation that stopped before it ran.
    const blocking = check.taskUnresolved.filter(
      (fact) => isBusinessEffect(fact.effect) && (!fact.result || fact.result.retry === 'never'),
    );
    if (blocking.length)
      return refuse(
        `Earlier business actions on this target have an unconfirmed outcome (${blocking.map((fact) => fact.actionId).join(', ')}): no new submit or invoke runs on it until they are checked. Reads and the other changes (navigate, fill, setValue, clear, select, plain keys and text, press with effect click) still work. To check them, observe and act with read-only steps (wait or scroll), a postcondition that proves the outcome and resolves naming them (status helps only an action that got no result), or ask the person to check the target and mark them as checked in the task.`,
      );
  }
  return { ok: true, action, effect, ...(resolves ? { resolves } : {}) };
}

/** A recipe-bound run's action: the recipe step it carries out, never invoke. */
function recipeBound(
  check: ActCheck,
  scope: Extract<RunScope, { mode: 'grant' | 'trial' }>,
  input: ComputerActionInput,
  actionId: string,
): Built | Refusal {
  if (input.resolves) return refuse('resolves is not available in a run that follows a recipe.');
  if (input.surfaceRefId)
    return refuse("A run that follows a recipe acts on the target's main window only.");
  if (check.facts.some((fact) => isUnresolvedFact(fact) && fact.effect !== 'read'))
    return refuse('An earlier action of this run has an unknown outcome; nothing more can run.');
  const built = recipeAction(scope.recipe, input, actionId, check.binding, check.facts);
  if (!built.ok) return built;
  const { action, effect } = built;
  if (action.steps.some((step) => stepEffect(step) === 'invoke' || isVisualStep(step)))
    return refuse('A run that follows a recipe cannot take that step.');
  if (effect === 'submit' && submitsSoFar(check.facts) >= scope.maxSubmits)
    return refuse(`This run already used its ${scope.maxSubmits} allowed submits.`);
  return { ok: true, action, effect, recipeStepId: built.stepId };
}

function highestEffect(action: ComputerAction): ComputerEffect {
  let highest: ComputerEffect = 'read';
  for (const step of action.steps) {
    const effect = stepEffect(step);
    if (COMPUTER_EFFECT_RANK[effect] > COMPUTER_EFFECT_RANK[highest]) highest = effect;
  }
  return highest;
}

/**
 * Submits the run attempted: every one that may have been dispatched. A recipe-bound run never
 * carries `invoke`, so `submit` is its only business effect.
 */
function submitsSoFar(facts: readonly ComputerFact[]): number {
  return facts.filter(
    (fact) => fact.effect === 'submit' && fact.result?.dispatch !== 'not_dispatched',
  ).length;
}
