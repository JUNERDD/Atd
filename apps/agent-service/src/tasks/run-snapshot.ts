import {
  DEFAULT_RUN_TOOLS,
  type RunSnapshot,
  type ServiceBlock,
  type SubmitTaskRequest,
  type TaskRun,
} from '@ai/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import { CONTEXT_BUDGET, runInputSize } from './run-budget.js';
import {
  resolveRunModel,
  resolveRunThinkingLevel,
  type RunContextWindow,
} from './run-selection.js';

/**
 * Freezes an accepted request into its run snapshot. Tools and memory come from the request,
 * else carry over from the task's last run (a command that turned memory off keeps it off for the
 * task's follow-ups), else the defaults. The context window freezes like the thinking level:
 * later tier changes never reach an accepted run. A snapshot over the context budget is refused.
 */
export function freezeRunSnapshot(
  request: SubmitTaskRequest,
  connections: ConnectionStore,
  contextWindowOf: RunContextWindow,
  last: TaskRun | undefined,
): RunSnapshot {
  const model = resolveRunModel(connections, request.model);
  const thinkingLevel = resolveRunThinkingLevel(connections, model, request.thinkingLevel);
  const contextWindow = contextWindowOf(model);
  const snapshot: RunSnapshot = {
    input: request.input,
    instructions: '',
    model,
    tools: [...(request.tools ?? last?.snapshot.tools ?? DEFAULT_RUN_TOOLS)],
    // Runs with memory search and learn through the service memory authority (harness slot).
    memory: request.memory ?? last?.snapshot.memory ?? true,
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(contextWindow ? { contextWindow } : {}),
    ...(request.branchBefore ? { branchBefore: request.branchBefore } : {}),
  };
  if (runInputSize(snapshot) > CONTEXT_BUDGET)
    throw new Error('The combined input and parameters exceed the context budget.');
  return snapshot;
}

/** The session entries of the user messages a task's transcript shows (`entryId`). */
export function userEntryIds(blocks: readonly ServiceBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) if (block.kind === 'user' && block.entryId) ids.add(block.entryId);
  return ids;
}

/**
 * Refuses a `branchBefore` that is not one of `onBranch`, the task's user message entries as its
 * transcript showed them at acceptance. Execution checks the entry again on the session itself.
 */
export function checkBranchBefore(
  branchBefore: string | undefined,
  onBranch: ReadonlySet<string> | null,
): void {
  if (branchBefore !== undefined && !onBranch?.has(branchBefore))
    throw new TypeError(
      "Invalid data: the message to replace is not a user message on the task's current branch.",
    );
}
