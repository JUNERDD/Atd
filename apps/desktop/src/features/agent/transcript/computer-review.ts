import { isTerminalStatus, type ComputerDetails } from '@atd/agent-contracts';
import type { TaskRun } from '../../../client/agent/task-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import type { ViewBlock } from './adapter';
import { computerDetails, computerOutcome } from './computer-call';

/** Only the original unsettled action or the earlier actions that held a call back are checkable. */
export function computerReviewActions(data: ComputerDetails) {
  const actionId = data.result?.actionId ?? data.actionId;
  const outcome = data.result ? computerOutcome(data.result) : null;
  const own =
    data.op === 'act' &&
    actionId !== undefined &&
    (outcome === null || outcome === 'unknown' || outcome === 'partial');
  return { own, actionIds: own ? [actionId] : (data.blockedBy ?? []) };
}

interface ReviewCall {
  block: BlockOf<'tool'>;
  data: ComputerDetails;
  own: boolean;
  actionIds: readonly string[];
}

/** A settled turn can belong to a still-active run, so use the source run's terminal status. */
export function computerReviewCalls(steps: readonly ViewBlock[], runs: readonly TaskRun[]) {
  const terminal = new Set(runs.filter((run) => isTerminalStatus(run.status)).map((run) => run.id));
  return steps.flatMap(({ source: block }): ReviewCall[] => {
    if (block.kind !== 'tool' || !terminal.has(block.runId)) return [];
    const data = computerDetails(block);
    if (!data) return [];
    const candidate = computerReviewActions(data);
    return candidate.actionIds.length > 0 ? [{ block, data, ...candidate }] : [];
  });
}

/**
 * Original action cards take precedence over blocked calls that name them. Deduplicate by fact,
 * including overlapping blockedBy lists, without rewriting the recorded tool details.
 */
export function unresolvedComputerCalls(
  calls: readonly ReviewCall[],
  unresolved: readonly string[],
) {
  const remaining = new Set(unresolved);
  const selected = new Map<string, ReviewCall>();
  for (const call of [...calls.filter((item) => item.own), ...calls.filter((item) => !item.own)]) {
    const actionIds = call.actionIds.filter((id) => remaining.delete(id));
    if (actionIds.length === 0) continue;
    selected.set(call.block.id, {
      ...call,
      actionIds,
      data: call.own ? call.data : { ...call.data, blockedBy: actionIds },
    });
  }
  return calls.flatMap((call) => {
    const selectedCall = selected.get(call.block.id);
    return selectedCall ? [selectedCall] : [];
  });
}
