import { createHash } from 'node:crypto';
import {
  canonicalJson,
  COMPUTER_ENGINE_FOR_KIND,
  type Automation,
  type AutomationComputerPolicy,
  type AutomationDraft,
  type CapabilityProfile,
  type ComputerBindingHashes,
  type ComputerRecipe,
  type ComputerRunGrant,
} from '@atd/agent-contracts';
import type { ComputerBindingSource } from './computer-deps.js';

/**
 * The hashes a computer grant binds to and the live check of a stored grant. Every hash is
 * SHA-256 over `canonicalJson`, so the shell and service agree byte for byte. A grant binds to
 * content, never to `revision`: enabling, pausing and an auto-pause bump the revision without
 * changing what the person approved. Any mismatch leaves the automation needing authorization;
 * nothing here repairs a grant.
 */

export function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** What a grant approves of an automation: its trigger, action and policy (with `computer`). */
export function definitionHash(automation: Pick<AutomationDraft, 'trigger' | 'action' | 'policy'>) {
  const { trigger, action, policy } = automation;
  return sha256Of({ trigger, action, policy });
}

export function recipeHash(recipe: ComputerRecipe): string {
  return sha256Of(recipe);
}

/** Each policy binding's live hash; null when one of them is no longer registered. */
export function liveBindingHashes(
  policy: AutomationComputerPolicy,
  bindings: ComputerBindingSource,
): ComputerBindingHashes | null {
  const hashes: ComputerBindingHashes = {};
  for (const id of policy.bindingIds) {
    const binding = bindings.get(id);
    if (!binding) return null;
    hashes[id] = binding.hash;
  }
  return hashes;
}

export function sameBindingHashes(a: ComputerBindingHashes, b: ComputerBindingHashes): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * The hash of the host profiles of the engines the policy's bindings need, sorted by engine; null
 * when a needed engine is not published or not qualified (no host, or a host that cannot serve
 * unattended runs). A trial records it and a grant keeps it, so an engine update needs a new trial.
 * It covers each whole published profile, so a change of the profile's shape or values (its
 * deliveries, actions, effects, qualification evidence) also invalidates every trial and grant
 * resting on it: intended, since a trial proves only the engine it ran with.
 */
export function engineProfilesHash(
  policy: AutomationComputerPolicy,
  bindings: ComputerBindingSource,
  profiles: readonly CapabilityProfile[],
): string | null {
  const engines = new Set<string>();
  for (const id of policy.bindingIds) {
    const binding = bindings.get(id);
    if (!binding) return null;
    engines.add(COMPUTER_ENGINE_FOR_KIND[binding.kind]);
  }
  const used: CapabilityProfile[] = [];
  for (const engine of [...engines].sort()) {
    const profile = profiles.find((item) => item.engine === engine);
    if (!profile || profile.qualification !== 'qualified') return null;
    used.push(profile);
  }
  return sha256Of(used);
}

/** Why a stored grant does not cover the automation as it is now. */
export type GrantProblem = 'missing' | 'revoked' | 'changed';

/**
 * Checks the automation's grant against its live content and bindings (not the command, whose
 * fingerprint needs a read and is checked where a fire is frozen and launched).
 */
export function grantProblem(
  automation: Automation,
  bindings: ComputerBindingSource,
): GrantProblem | undefined {
  const { policy, computerGrant: grant } = automation;
  if (!policy.computer || !grant) return 'missing';
  if (grant.revokedAt !== undefined) return 'revoked';
  if (grant.definitionHash !== definitionHash(automation)) return 'changed';
  if (grant.recipeHash !== recipeHash(policy.computer.recipe)) return 'changed';
  const live = liveBindingHashes(policy.computer, bindings);
  if (!live || !sameBindingHashes(live, grant.bindingHashes)) return 'changed';
  return undefined;
}

/** What an unattended run freezes from a valid grant (`RunComputer.grant`). */
export function runGrantOf(automation: Automation): ComputerRunGrant {
  const grant = automation.computerGrant;
  if (!grant) throw new Error('The automation has no computer grant.');
  return {
    automationId: automation.id,
    grantId: grant.grantId,
    version: grant.version,
    recipeHash: grant.recipeHash,
    bindingHashes: grant.bindingHashes,
  };
}

/**
 * Durably revokes the grants naming `bindingId` whose stored hash no longer matches the binding
 * (changed or deleted), on a store draft. Answers the automations whose grant it revoked.
 */
export function revokeForBinding(
  automations: Automation[],
  bindingId: string,
  bindings: ComputerBindingSource,
  now: string,
): string[] {
  const live = bindings.get(bindingId)?.hash;
  const revoked: string[] = [];
  for (const automation of automations) {
    const grant = automation.computerGrant;
    if (!grant || grant.revokedAt !== undefined) continue;
    const approved = grant.bindingHashes[bindingId];
    if (approved === undefined || approved === live) continue;
    grant.revokedAt = now;
    automation.revision += 1;
    automation.updatedAt = now;
    revoked.push(automation.id);
  }
  return revoked;
}
