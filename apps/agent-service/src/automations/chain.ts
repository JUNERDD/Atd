import type { Automation, AutomationRun } from '@atd/agent-contracts';
import type { Upstream } from './prompt.js';

/**
 * Which automations a settled run fires through their chain triggers, and what they learn of it.
 * Results a chain can follow are delivered, nothing new, needs attention and failed (a timeout
 * counts as failed). The followers get the upstream's run id and whether it left computer effects
 * unresolved: a follower that only reads or notifies still fires, one that would act on the
 * computer is held back (computer-fire.ts), and none inherits the upstream's grant.
 */
export function chainedTo(
  automations: readonly Automation[],
  upstream: Automation,
  record: AutomationRun,
  answer: string,
): { followers: Automation[]; upstream: Upstream } | null {
  const outcome = record.outcome === 'timedOut' ? 'failed' : record.outcome;
  if (
    outcome !== 'delivered' &&
    outcome !== 'nothingNew' &&
    outcome !== 'needsAttention' &&
    outcome !== 'failed'
  )
    return null;
  const followers = automations.filter(({ enabled, trigger }) => {
    if (!enabled || trigger.kind !== 'automation') return false;
    return trigger.automationId === upstream.id && trigger.outcomes.includes(outcome);
  });
  const unresolved =
    (record.computer?.unresolvedActionIds.length ?? 0) > 0 ||
    record.reason === 'computerUnknownEffect';
  return {
    followers,
    upstream: { name: upstream.name, result: outcome, answer, runId: record.id, unresolved },
  };
}
