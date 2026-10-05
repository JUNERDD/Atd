import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { errorMessage, rootExecutionId } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import type { MemoryRunScope } from '../memory/engine-types.js';
import { logMemoryEvents, MemoryAuthority } from '../memory/index.js';
import { memoryLearner } from '../memory/learner/index.js';
import { sessionMemory } from '../memory/session-memory.js';
import { memoryTools } from '../memory/tools.js';
import type { SessionFactoryDeps } from '../pi-session.js';
import type { ServicePaths } from '../storage.js';
import type { HarnessDeps } from './deps.js';

/**
 * What the memory extension uses of the harness deps: the run that built the session, the
 * learner's source, and the runner's task, runs, material, deletion, agent dir and log.
 */
export type MemoryExtensionDeps = Pick<HarnessDeps, 'run' | 'source'> & {
  runner: Pick<SessionFactoryDeps, 'taskId' | 'currentRunId' | 'currentMaterial' | 'deleted'> & {
    ctx: { paths: Pick<ServicePaths, 'agentDir'>; log: Logger };
  };
};

/**
 * The parent session's memory when the run snapshot enables memory, `null` otherwise
 * (docs/plans/2026-10-04-skill-shaped-memory.md): the current run's frozen memory sections
 * (memory/session-memory.ts; the harness registers after the skill catalog, so they render after
 * it), the memory tools (memory/tools.ts; the run binding allowlists them under the same flag) and
 * automatic learning (memory/learner). All three go through the memory authority, which checks
 * the learning policy on every write. A store that cannot load is logged and leaves the session
 * without memory instead of failing the run.
 *
 * All three share one scope: the run the session last served, first the run that built it, then
 * each run it starts. A tool call records its own run, and a review after the task moved on to
 * another session (a binding change) names the run whose conversation it read, not the task's
 * current one. The memory flag is part of the binding key, so it holds for the session until the
 * task is deleted (`SessionFactoryDeps.deleted`); from then on the scope reads memory off.
 */
export async function memoryExtension(deps: MemoryExtensionDeps): Promise<ExtensionFactory | null> {
  const { run, runner } = deps;
  if (!run.snapshot.memory) return null;
  const { log } = runner.ctx;
  const store = await MemoryAuthority.authorityFor(
    runner.ctx.paths.agentDir,
    logMemoryEvents(log),
  ).catch((error: unknown) => {
    log.warn('Memory is unavailable; the task continues without it.', {
      taskId: runner.taskId,
      error: errorMessage(error),
    });
    return null;
  });
  if (!store) return null;
  let servedRunId = run.id;
  const scope = (): MemoryRunScope => ({
    // A getter, read whenever the store checks the scope: a review keeps the scope it started
    // with, and the store reads this again at commit, so a review that outlives the task's
    // deletion commits nothing.
    get runMemory() {
      return run.snapshot.memory && !runner.deleted();
    },
    executionId: rootExecutionId(servedRunId),
    taskId: runner.taskId,
    runId: servedRunId,
  });
  const factories = [
    sessionMemory(() => runner.currentMaterial().memory),
    memoryTools({ store, scope, readOnly: false }),
    memoryLearner({ store, scope, source: deps.source, log }),
  ];
  return async (pi) => {
    // Pi starts a run's agent loop before its first tool call, and only on the run's own session.
    pi.on('agent_start', () => {
      servedRunId = runner.currentRunId();
    });
    for (const factory of factories) await factory(pi);
  };
}
