import { canonicalJson, isUnresolvedFact, type ComputerFact } from '@atd/agent-contracts';
import type { ComputerRecords } from './records.js';

/*
 * Resolution of unresolved computer facts (contract addendum A1, A2): a business fact (`submit`,
 * `invoke`) whose outcome was left unknown or partial blocks new business actions on its target
 * in the same task (policy.ts), and any unresolved fact holds an automation run, until it is
 * resolved, either by a later read-only action of the task whose original absolute postcondition the host verified again
 * (`verified`) or by a person who checked it (`person`). Resolving appends a record with
 * `resolution`; the latest record per action wins, so the fact stops counting as unresolved
 * (`isUnresolvedFact`) without its result being rewritten.
 */

/** The unresolved fact of `actionId` if it belongs to `taskId` (and `bindingId`, when given). */
function openFact(
  records: ComputerRecords,
  actionId: string,
  taskId: string,
  bindingId?: string,
): ComputerFact | undefined {
  const fact = records.find(actionId);
  if (!fact || fact.taskId !== taskId || !isUnresolvedFact(fact)) return undefined;
  return bindingId === undefined || fact.bindingId === bindingId ? fact : undefined;
}

async function resolveAll(
  records: ComputerRecords,
  facts: readonly ComputerFact[],
  resolution: NonNullable<ComputerFact['resolution']>,
): Promise<string[]> {
  for (const fact of facts) await records.append({ ...fact, resolution, at: resolution.at });
  return facts.map((fact) => fact.actionId);
}

/** A later check may repeat the promised outcome, never substitute an easier condition. */
export function resolutionProblem(
  fact: ComputerFact,
  verification: ComputerFact['verification'],
): string | null {
  const expected = fact.verification;
  if (!expected)
    return `Action ${fact.actionId} recorded no postcondition; only a person can resolve it.`;
  if (expected.condition.kind === 'newText')
    return `Action ${fact.actionId} used newText relative to its original observation. A later observation cannot rebase that proof; a person must check it.`;
  if (expected.condition.kind === 'enabled')
    return `Action ${fact.actionId} checked availability, not completion; a person must check it.`;
  if (!verification || canonicalJson(expected) !== canonicalJson(verification))
    return `Action ${fact.actionId} must be checked with its original condition and surface: ${canonicalJson(expected)}. Do not substitute an unrelated label.`;
  return null;
}

/**
 * Resolves the named facts of the verifying action's task and binding with `verified` by it;
 * answers the ids it resolved (facts settled or resolved meanwhile are left as they are).
 */
export function resolveVerified(
  records: ComputerRecords,
  actionIds: readonly string[],
  by: ComputerFact,
): Promise<string[]> {
  if (by.effect !== 'read' || by.result?.effect !== 'verified') return Promise.resolve([]);
  const facts = actionIds.flatMap((id) => {
    const fact = openFact(records, id, by.taskId, by.bindingId);
    return fact && resolutionProblem(fact, by.verification) === null ? [fact] : [];
  });
  const at = new Date().toISOString();
  return resolveAll(records, facts, { kind: 'verified', by: by.actionId, at });
}

/** Resolves the named facts of a task a person checked; answers the ids it resolved. */
export function resolveByPerson(
  records: ComputerRecords,
  taskId: string,
  actionIds: readonly string[],
): Promise<string[]> {
  const facts = actionIds.flatMap((id) => openFact(records, id, taskId) ?? []);
  return resolveAll(records, facts, { kind: 'person', at: new Date().toISOString() });
}
