import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { rootExecutionId } from '@atd/agent-contracts';
import { ContextTracker } from './compaction/context-state.js';
import type { CompactionObserver } from './compaction/observer.js';
import { LiveTranscript } from './live-transcript.js';
import type { RunModel } from './run-model.js';
import type { RunnerContext } from './task-runner.js';

/** A task's live Pi session and what follows it. */
export interface LiveState {
  session: AgentSession;
  runModel: RunModel;
  manager: SessionManager;
  transcript: LiveTranscript;
  compaction: CompactionObserver;
  context: ContextTracker;
  sessionFile: string;
  /**
   * Key of the run binding the session was built with (run-binding.ts); empty for a session
   * built only to compact (compaction/manual.ts), which no run ever reuses.
   */
  bindingKey: string;
}

export interface BindLiveInput {
  ctx: RunnerContext;
  taskId: string;
  session: AgentSession;
  manager: SessionManager;
  runModel: RunModel;
  /** Created before the session, whose loader registers its extension. */
  compaction: CompactionObserver;
  bindingKey: string;
  currentRunId: () => string;
  /** The task's first run (see `ProjectServiceBlocksInput.firstRunId`). */
  firstRunId: string;
}

/**
 * Follows a created session: its compactions, then its transcript and context state, in that
 * subscription order (compaction/observer.ts), each published as the task's events. The task
 * records the session file once Pi has one.
 */
export async function bindLiveState(input: BindLiveInput): Promise<LiveState> {
  const { ctx, taskId, session, manager, compaction, currentRunId } = input;
  const recordSessionFile = (file: string) =>
    ctx.ledger.change((data) => {
      const item = data.tasks.find((entry) => entry.id === taskId);
      if (item) item.sessionFile = file;
    });
  compaction.attach(session);
  const state: LiveState = {
    session,
    runModel: input.runModel,
    manager,
    compaction,
    transcript: new LiveTranscript(
      session,
      manager,
      {
        publish: (runId, patch) => {
          ctx.events.publish({
            taskId,
            runId,
            executionId: rootExecutionId(runId),
            type: 'transcript.patch',
            data: patch,
          });
        },
        queue: (runId, queue) => {
          ctx.events.publish({
            taskId,
            runId,
            executionId: rootExecutionId(runId),
            type: 'queue.update',
            data: queue,
          });
        },
        sessionFile: (file) => {
          if (file === state.sessionFile) return;
          state.sessionFile = file;
          void recordSessionFile(file).catch(() => undefined);
        },
      },
      currentRunId,
      input.firstRunId,
      () => compaction.running(),
    ),
    context: new ContextTracker(session, compaction, (data) => {
      const runId = currentRunId();
      ctx.events.publish({
        taskId,
        runId: runId || null,
        executionId: rootExecutionId(runId || 'pending'),
        type: 'context.update',
        data,
      });
    }),
    sessionFile: session.sessionFile ?? '',
    bindingKey: input.bindingKey,
  };
  state.transcript.attach();
  state.context.attach();
  // A manual compaction shows once prepared, which no session event marks (compaction/observer.ts).
  compaction.onChange(() => state.transcript.reproject(false));
  if (state.sessionFile) await recordSessionFile(state.sessionFile);
  return state;
}
