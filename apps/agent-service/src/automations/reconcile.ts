import { errorMessage } from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { AutomationRuns } from './engine-deps.js';
import { operationIdFor } from './launch-run.js';
import type { Settlement } from './records.js';
import type { AutomationStore } from './store.js';
import type { WatchedRun } from './supervisor.js';

/** The longest maximum duration; an adopted run of a deleted automation gets it. */
const LONGEST_RUN_MS = 240 * 60_000;

export interface ReconcileDeps {
  store: AutomationStore;
  ledger: Ledger;
  manager: Pick<AutomationRuns, 'cancel'>;
  log: Logger;
  watch: (run: WatchedRun) => void;
  watching: (runId: string) => boolean;
  settle: (automationId: string, recordId: string, result: Settlement) => Promise<void>;
  /** The chain depth an adopted run counts as. */
  adoptedDepth: number;
}

/**
 * Boot reconciliation (decision D6), after the service's own recovery and before queued task runs
 * dispatch. A record still `running` whose fire never reached the ledger (its operation id is
 * unknown), a memory consolidation's included, ends `interrupted`, and is never retried. One
 * whose task run exists is watched again: the supervisor settles a run that already ended from the
 * ledger (recovery marked runs that were live as interrupted), and a queued run of an automation
 * that is off is cancelled first. Queued runs of automations that were deleted or turned off are
 * cancelled too.
 */
export async function reconcileRuns(deps: ReconcileDeps): Promise<void> {
  const { store, ledger } = deps;
  // Unreadable files: nothing can be matched, so nothing is touched.
  if (store.problem) return;
  const { definitions, state } = store.data;
  for (const [automationId, entry] of Object.entries(state.automations)) {
    const automation = definitions.automations.find((item) => item.id === automationId);
    for (const record of entry.runs) {
      if (record.outcome !== 'running') continue;
      const operation = ledger.operation(operationIdFor(automationId, record.id));
      if (!operation) {
        // A memory consolidation starts no task, so it ended with the process that ran it.
        const consolidation = automation?.action.kind === 'consolidateMemory';
        await deps.settle(
          automationId,
          record.id,
          consolidation
            ? {
                outcome: 'interrupted',
                detail: 'Atd stopped during the memory consolidation.',
                read: true,
              }
            : { outcome: 'interrupted', detail: 'Atd stopped before the run started.' },
        );
        continue;
      }
      if (!automation?.enabled) await cancelQueued(deps, operation.taskId, operation.runId);
      if (record.runId !== operation.runId)
        await store.change((draft) => {
          const live = draft.state.automations[automationId]?.runs.find(
            (run) => run.id === record.id,
          );
          if (live) Object.assign(live, operation);
        });
      deps.watch({
        automationId,
        recordId: record.id,
        taskId: operation.taskId,
        runId: operation.runId,
        // Its clock starts when it runs: a run queued across the restart starts only now.
        startedAt: null,
        maxDurationMs: automation ? automation.policy.maxDurationMinutes * 60_000 : LONGEST_RUN_MS,
        depth: deps.adoptedDepth,
        timedOut: false,
      });
    }
  }
  for (const task of ledger.data.tasks) {
    if (task.origin?.kind !== 'automation') continue;
    const { automationId } = task.origin;
    if (definitions.automations.find((item) => item.id === automationId)?.enabled) continue;
    for (const run of task.runs)
      if (run.status === 'queued' && !deps.watching(run.id))
        await cancelQueued(deps, task.id, run.id);
  }
}

async function cancelQueued(deps: ReconcileDeps, taskId: string, runId: string): Promise<void> {
  try {
    if (deps.ledger.run(taskId, runId).status !== 'queued') return;
    await deps.manager.cancel(taskId, runId);
  } catch (error) {
    deps.log.warn('A queued run of an automation that is off could not be cancelled.', {
      taskId,
      error: errorMessage(error),
    });
  }
}
