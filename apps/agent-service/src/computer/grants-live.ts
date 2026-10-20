import type { ComputerBindingSource } from '../automations/computer-deps.js';
import {
  definitionHash,
  grantProblem,
  liveBindingHashes,
  recipeHash,
  sameBindingHashes,
} from '../automations/computer-grant.js';
import type { AutomationStore } from '../automations/store.js';
import type { ComputerGrantCheck } from './grant-check.js';

/**
 * The live check of the authorization a recipe-bound run froze (decision D11), which the computer
 * policy asks before every step: an unattended run's grant (`RunComputer.grant`) and an attended
 * trial's scope (`RunComputer.trial`). It reads the automations as they are now, so revoking a
 * grant, re-authorizing (a new grant id), editing what it approved, changing or deleting a bound
 * target, deleting the automation or a hold stops the very next step of a run that is going.
 */

/**
 * The check over the automations store and the binding store (grant-check.ts). The composition
 * root injects it after `AutomationService.create` through `ComputerRuntime.setGrantCheck`.
 */
export function createComputerGrantCheck(
  store: Pick<AutomationStore, 'data'>,
  bindings: ComputerBindingSource,
): ComputerGrantCheck {
  const find = (id: string) => store.data.definitions.automations.find((item) => item.id === id);
  return {
    check(frozen) {
      const automation = find(frozen.automationId);
      const policy = automation?.policy.computer;
      const grant = automation?.computerGrant;
      if (!automation || !policy || !grant) return { ok: false, reason: 'missing' };
      if (grant.grantId !== frozen.grantId || grant.version !== frozen.version)
        return { ok: false, reason: 'revoked' };
      const problem = grantProblem(automation, bindings);
      if (problem === 'missing' || problem === 'revoked') return { ok: false, reason: problem };
      if (
        problem === 'changed' ||
        grant.recipeHash !== frozen.recipeHash ||
        !sameBindingHashes(grant.bindingHashes, frozen.bindingHashes)
      )
        return { ok: false, reason: 'changed' };
      if (store.data.state.automations[automation.id]?.computerHold)
        return { ok: false, reason: 'hold' };
      return { ok: true, recipe: policy.recipe, maxSubmits: policy.maxSubmits };
    },
    trial(frozen) {
      const automation = find(frozen.automationId);
      if (!automation) return { ok: false, reason: 'missing' };
      const policy = automation.policy.computer;
      const live = policy ? liveBindingHashes(policy, bindings) : null;
      if (
        !policy ||
        !live ||
        definitionHash(automation) !== frozen.definitionHash ||
        recipeHash(policy.recipe) !== frozen.recipeHash ||
        !sameBindingHashes(live, frozen.bindingHashes)
      )
        return { ok: false, reason: 'changed' };
      return { ok: true, recipe: policy.recipe, maxSubmits: policy.maxSubmits };
    },
  };
}
