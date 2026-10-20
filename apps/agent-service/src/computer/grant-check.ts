import type { ComputerRecipe, ComputerRunGrant, ComputerRunTrial } from '@atd/agent-contracts';

/**
 * What a recipe-bound run may do right now: the recipe its grant or trial froze and the submit
 * budget. The automations module owns grants and trials (automations' `grants-live.ts`); the
 * computer policy only codes against this interface, checked live on every action, so a revoked,
 * changed or held automation stops at its next step.
 */
export type ComputerGrantVerdict =
  | { ok: true; recipe: ComputerRecipe; maxSubmits: number }
  | { ok: false; reason: 'revoked' | 'changed' | 'hold' | 'missing' };

export type ComputerTrialVerdict =
  | { ok: true; recipe: ComputerRecipe; maxSubmits: number }
  | { ok: false; reason: 'changed' | 'missing' };

export interface ComputerGrantCheck {
  /** An unattended run's frozen grant against the live automation, grant and bindings. */
  check(grant: ComputerRunGrant): ComputerGrantVerdict;
  /** An attended trial run's frozen hashes against the live automation and bindings. */
  trial(trial: ComputerRunTrial): ComputerTrialVerdict;
}

/**
 * The check in place until the automations module supplies the real one
 * (`ComputerRuntime.setGrantCheck`): every grant and trial counts as missing, so no recipe-bound
 * run acts. Failing closed keeps unattended computer work impossible without a live grant.
 */
export const REFUSE_ALL_GRANTS: ComputerGrantCheck = {
  check: () => ({ ok: false, reason: 'missing' }),
  trial: () => ({ ok: false, reason: 'missing' }),
};
