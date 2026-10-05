import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { LearnerJobs } from './jobs.js';
import { runLearnerJob, type LearnerHost } from './model.js';
import { inLearnableRun, messageText } from './transcript.js';
import { LearnerTriggers, type LearnerRequest } from './triggers.js';

export type { LearnerHost, LearnerSource } from './model.js';
export type { LearnerTrigger } from './triggers.js';

/**
 * How long a closing session that may still learn waits for its memory reviews before aborting
 * them; Pi awaits the `session_shutdown` handler, and the session file stays closed to new runs
 * until it returns.
 */
export const SHUTDOWN_CAP_MS = 10_000;

/**
 * Automatic memory learning for a root task session (decision R5). It watches the session's
 * events for the triggers in triggers.ts and runs each review on the run's own model in the
 * background (model.ts), one at a time per session (jobs.ts); the store applies or queues what a
 * review commits, only while the run's memory flag, the pause setting and the policy version
 * captured at the review's start still allow it. Runs that learning may not read (command runs,
 * runs with memory off; transcript.ts) feed no trigger and no review.
 *
 * Compaction does not wait for its review: the session file keeps the messages a compaction
 * summarizes, and the review reads them from there. A closing session that may still learn (a
 * release, the service stopping) waits up to `SHUTDOWN_CAP_MS` for running reviews and for one
 * more when two user messages came since the last, then aborts what is left. One that may not
 * learn (its task was deleted, or learning is paused) starts none and aborts running ones at
 * once: the store would refuse what they commit.
 *
 * Wiring: `harness/memory-extension.ts` registers `memoryLearner(host)` beside the memory tools
 * when the run snapshot enables memory, for the parent session only (`prepareHarness`; children
 * never learn, and `canLearn` refuses them too):
 * - `store`: the memory authority, the same `MemoryRuntimeStore` the tools use.
 * - `scope`: `{ runMemory, executionId, taskId, runId }` of the run the session last served (the
 *   run that built it, then each run it starts), so a review after the task moved on to another
 *   session names the run whose conversation it read. The memory flag is part of the binding key,
 *   so it holds for the session until the task is deleted; from then on `runMemory` reads false.
 * - `source`: the run's `ModelRuntime`, the session's current model and its branch, the shape of
 *   the auto reviewer's `source` (task-runner.ts passes `createReviewer` a closure over
 *   `this.slot.live`, carried to sessions by `SessionFactoryDeps.review`). That closure answers
 *   null during the shutdown review, because `LiveSlot.close` detaches the session before it
 *   emits `session_shutdown` (session-release.ts). So pi-session.ts `createLiveState` builds
 *   this one per session, from `runModel.models`, `created.session.model ?? runModel.model` and
 *   `manager.getBranch()`, and hands it to the harness on `HarnessDeps`.
 * - `log`: `runner.ctx.log`.
 */
export function memoryLearner(host: LearnerHost): ExtensionFactory {
  return (pi) => {
    const triggers = new LearnerTriggers();
    const jobs = new LearnerJobs(async (request, signal) => {
      triggers.reviewed();
      await runLearnerJob(host, request, signal);
    }, host.log);
    // Whether learning may read the current run; every run opens with its user message.
    let learnable = true;
    const request = (next: LearnerRequest | null): void => {
      if (next && host.store.canLearn(host.scope())) jobs.request(next);
    };

    pi.on('message_end', (event, ctx) => {
      if (event.message.role !== 'user') return;
      learnable = inLearnableRun(ctx.sessionManager.getBranch());
      if (learnable) triggers.userMessage(messageText(event.message.content));
    });
    pi.on('turn_end', (event) => {
      if (!learnable) return;
      const { message } = event;
      const toolCalls =
        message.role === 'assistant'
          ? message.content.filter((part) => part.type === 'toolCall').length
          : 0;
      request(triggers.turnEnded(toolCalls));
    });
    pi.on('session_before_compact', () => {
      if (triggers.compactionDue()) request({ trigger: 'compaction' });
    });
    pi.on('agent_settled', () => {
      if (triggers.idleDue()) request({ trigger: 'idle' });
    });
    pi.on('session_shutdown', async (event) => {
      if (!host.store.canLearn(host.scope())) {
        await jobs.abort();
        return;
      }
      const last =
        event.reason !== 'reload' && triggers.idleDue() ? { trigger: 'shutdown' as const } : null;
      await jobs.close(last, SHUTDOWN_CAP_MS);
    });
  };
}
