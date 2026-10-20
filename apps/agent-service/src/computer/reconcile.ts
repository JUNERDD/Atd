import {
  COMPUTER_MAX_STATUS_IDS,
  type ComputerFact,
  type ExecutionEnvelope,
  type HostActionRecord,
} from '@atd/agent-contracts';
import { serviceEnvelope, type HostOutcome } from './pending.js';
import type { ComputerRecords } from './records.js';
import { withoutDownloads } from './transfers.js';

export interface ReconcileDeps {
  records: ComputerRecords;
  /** The actions the host's journal lists without a settled result (`computer.hello`). */
  unsettled: readonly string[];
  /** Asks the bound host for its journal records of some actions of one run. */
  status: (envelope: ExecutionEnvelope, actionIds: string[]) => Promise<HostOutcome>;
}

/**
 * Converges the service's unresolved facts with the host's journal after a (re)connect (D3): for
 * every unresolved fact this process knows, and every unsettled action the host names that the
 * service has a fact for, it asks `status` per run and records each settled result the host
 * reports. An action the host has no settled record of stays unresolved: absence is not proof
 * that nothing happened, so only a person resolving it ends it.
 */
export async function reconcileFacts(deps: ReconcileDeps): Promise<void> {
  const wanted = new Map<string, ComputerFact>();
  for (const fact of deps.records.unresolved()) wanted.set(fact.actionId, fact);
  for (const actionId of deps.unsettled) {
    const fact = deps.records.find(actionId);
    if (fact && !fact.result) wanted.set(actionId, fact);
  }
  const byRun = new Map<string, ComputerFact[]>();
  for (const fact of wanted.values())
    byRun.set(fact.runId, [...(byRun.get(fact.runId) ?? []), fact]);
  for (const facts of byRun.values()) {
    const [first] = facts;
    if (!first) continue;
    for (let start = 0; start < facts.length; start += COMPUTER_MAX_STATUS_IDS) {
      const chunk = facts.slice(start, start + COMPUTER_MAX_STATUS_IDS);
      const envelope = serviceEnvelope(first.taskId, first.runId, 'reconcile');
      const outcome = await deps.status(
        envelope,
        chunk.map((fact) => fact.actionId),
      );
      if (outcome.kind !== 'reply' || !outcome.reply.ok) continue;
      const { value } = outcome.reply;
      if (value.kind !== 'status') continue;
      await settleFromJournal(deps.records, value.records);
    }
  }
}

/**
 * Records the settled results a host journal reports for facts that have none yet, without the
 * host's download paths. A record of another run than the fact's is ignored: action ids are
 * matched within their run only.
 */
export async function settleFromJournal(
  records: ComputerRecords,
  journal: readonly HostActionRecord[],
): Promise<ComputerFact[]> {
  const settled: ComputerFact[] = [];
  for (const record of journal) {
    const fact = records.find(record.actionId);
    if (!fact || fact.result || fact.runId !== record.runId) continue;
    if (record.phase !== 'settled' || !record.result) continue;
    const next: ComputerFact = {
      ...fact,
      phase: 'settled',
      // A journal's download paths are not imported here: the reply that carried them was lost.
      result: withoutDownloads(record.result),
      at: new Date().toISOString(),
    };
    await records.append(next);
    settled.push(next);
  }
  return settled;
}
