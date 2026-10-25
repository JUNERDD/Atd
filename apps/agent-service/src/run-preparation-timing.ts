import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

type PreparationOutcome = 'completed' | 'error' | 'stopped' | 'no_turn';

interface PreparationScope {
  taskId: string;
  runId: string;
  audit(entry: Record<string, unknown>): void;
  startedAt: number;
  startedMono: number;
  finished: boolean;
}

const preparation = new AsyncLocalStorage<PreparationScope>();

/** Carries one run's preparation timing through its existing async assembly, without global state. */
export function withRunPreparation<T>(
  taskId: string,
  runId: string,
  audit: PreparationScope['audit'],
  action: () => T,
): T {
  return preparation.run(
    {
      taskId,
      runId,
      audit,
      startedAt: Date.now(),
      startedMono: performance.now(),
      finished: false,
    },
    action,
  );
}

function record(
  scope: PreparationScope,
  phase: string,
  startedAt: number,
  durationMs: number,
  outcome: PreparationOutcome,
): void {
  scope.audit({
    taskId: scope.taskId,
    runId: scope.runId,
    preparation: {
      phase,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, Math.round(durationMs)),
      outcome,
    },
  });
}

/** Server acceptance precedes execution; this is not the caller's untrusted capturedAt. */
export function recordPreparationQueue(acceptedAt: string): void {
  const scope = preparation.getStore();
  if (scope) {
    const accepted = Date.parse(acceptedAt);
    record(scope, 'accepted_to_execute', accepted, scope.startedAt - accepted, 'completed');
  }
}

/** Nested and concurrent stages overlap; their durations must not be summed into a total. */
export async function timePreparation<T>(phase: string, action: () => Promise<T>): Promise<T> {
  const scope = preparation.getStore();
  if (!scope || scope.finished) return action();
  const startedAt = Date.now();
  const startedMono = performance.now();
  let outcome: PreparationOutcome = 'completed';
  try {
    return await action();
  } catch (error) {
    outcome = 'error';
    throw error;
  } finally {
    record(scope, phase, startedAt, performance.now() - startedMono, outcome);
  }
}

/** Stops the total at the first turn, or at a preparation failure/cancellation. */
export function finishRunPreparation(outcome: PreparationOutcome): void {
  const scope = preparation.getStore();
  if (!scope || scope.finished) return;
  scope.finished = true;
  record(
    scope,
    'execute_to_first_turn',
    scope.startedAt,
    performance.now() - scope.startedMono,
    outcome,
  );
}

/** Times Pi's prompt preparation only; app-inference owns the interval from turn_start onward. */
export async function promptWithPreparation(
  session: Pick<AgentSession, 'subscribe'>,
  prompt: () => Promise<void>,
): Promise<void> {
  const scope = preparation.getStore();
  if (!scope) return prompt();
  const startedAt = Date.now();
  const startedMono = performance.now();
  let finished = false;
  const finish = (outcome: PreparationOutcome) => {
    if (finished) return;
    finished = true;
    record(scope, 'prompt_before_turn', startedAt, performance.now() - startedMono, outcome);
    finishRunPreparation(outcome);
  };
  const unsubscribe = session.subscribe((event) => {
    if (event.type === 'turn_start') finish('completed');
  });
  try {
    await prompt();
    finish('no_turn');
  } catch (error) {
    finish('error');
    throw error;
  } finally {
    unsubscribe();
  }
}
