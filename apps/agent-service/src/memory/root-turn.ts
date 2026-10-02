import { errorMessage, rootExecutionId, type TaskRun } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { logMemoryEvents, MemoryAuthority } from './authority.js';
import { runRootMemoryOperation, type RunnerMemoryScope } from './proxy.js';

/**
 * Root-runner access to the memory authority. Memory is an optional capability of a run: when the
 * Hermes store cannot load (missing native module, corrupt Markdown/SQLite, sync warnings) the
 * failure is logged and the run continues without memory, as child runners already do
 * (subagents/enrich.ts). The authority drops a failed load, so the next session or turn retries.
 */
export interface RootMemoryHost {
  agentDir: string;
  log: Logger;
  taskId: string;
}

/** The memory scope of a root run: its frozen memory flag and root execution id. */
export function rootMemoryScope(taskId: string, run: TaskRun): RunnerMemoryScope {
  return {
    runMemory: run.snapshot.memory,
    executionId: rootExecutionId(run.id),
    taskId,
    runId: run.id,
  };
}

/** The service authority, or `null` (logged) when the store cannot load. */
export async function rootMemoryAuthority(host: RootMemoryHost): Promise<MemoryAuthority | null> {
  try {
    return await MemoryAuthority.authorityFor(host.agentDir, logMemoryEvents(host.log));
  } catch (error) {
    host.log.warn('Memory is unavailable; the task continues without it.', {
      taskId: host.taskId,
      error: errorMessage(error),
    });
    return null;
  }
}

/**
 * Runs root session work (a prompt, or the session_shutdown flush) inside the authority's write
 * scope, so Hermes' write guard admits memory tool calls and its review/flush learners while the
 * policy (run flag, pause, revision) allows them. Without memory, or without a loadable store,
 * the work runs unchanged; errors from the work itself always propagate.
 */
export async function withRootMemoryTurn<T>(
  host: RootMemoryHost,
  scope: RunnerMemoryScope | null,
  action: () => Promise<T>,
): Promise<T> {
  if (!scope?.runMemory) return action();
  const authority = await rootMemoryAuthority(host);
  if (!authority) return action();
  return runRootMemoryOperation(authority, scope, action);
}
