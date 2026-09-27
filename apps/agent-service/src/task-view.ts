import path from 'node:path';
import { SessionManager, type SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import {
  errorMessage,
  type ServiceBlock,
  type ServiceModel,
  type TaskContextState,
  type TaskSnapshot,
  type TaskSummary,
  emptyContextState,
} from '@ai/agent-contracts';
import { coldContextState } from './compaction/context-state.js';
import { ConnectionStore } from './credentials/connections.js';
import type { LiveState } from './live-state.js';
import { presentConnection } from './providers/connection-view.js';
import type { RunnerContext, TaskRunner } from './task-runner.js';
import { fromServiceBranch, projectServiceBlocks } from './transcript.js';

/** What a task snapshot shows of a task's session. */
export interface TaskView {
  revision: number;
  blocks: ServiceBlock[];
  context: TaskContextState;
}

export function liveTaskView(live: LiveState): TaskView {
  return { ...live.transcript.snapshot(), context: live.context.current() };
}

/**
 * A task as a task list shows it, built from memory only: no session read and no runner, so
 * summarizing every task stays cheap. `runner` is the task's runner when one exists.
 */
export function taskSummary(
  ctx: RunnerContext,
  runner: TaskRunner | undefined,
  taskId: string,
): TaskSummary {
  return {
    task: ctx.ledger.task(taskId),
    requests: ctx.confirms.forTask(taskId),
    capabilities: ctx.capabilities.forTask(taskId),
    queue: runner?.queueState() ?? { steering: [], followUp: [] },
  };
}

/**
 * The summary plus the task's transcript and context. A task without a runner has no live
 * session: its view is cold-projected from its Pi JSONL, so a snapshot never creates a runner.
 */
export async function taskSnapshot(
  ctx: RunnerContext,
  runner: TaskRunner | undefined,
  taskId: string,
): Promise<TaskSnapshot> {
  const view = runner ? await runner.view() : await coldTaskView(ctx, taskId);
  // The summary is read with `seq`, after the view's await: an event published meanwhile must be
  // in the snapshot when its seq is, or a client would cache the older state over it.
  return {
    ...taskSummary(ctx, runner, taskId),
    revision: view.revision,
    blocks: view.blocks,
    context: view.context,
    epoch: ctx.events.epoch,
    seq: ctx.events.currentSeq,
  };
}

/**
 * A task without a live session, read from its session file: the same block projection the
 * live path uses, and context state estimated from the file with the latest run's window.
 */
export async function coldTaskView(ctx: RunnerContext, taskId: string): Promise<TaskView> {
  const task = ctx.ledger.task(taskId);
  const [first] = task.runs;
  const last = task.runs.at(-1);
  if (!task.sessionFile || !first || !last)
    return { revision: 0, blocks: [], context: emptyContextState() };
  try {
    const manager = SessionManager.open(
      task.sessionFile,
      path.join(ctx.paths.sessionsDir, taskId),
      ctx.paths.agentDir,
    );
    const branch = fromServiceBranch(manager.getBranch());
    const window =
      last.snapshot.contextWindow ?? (await catalogWindow(ctx.paths.root, last.snapshot.model));
    return {
      revision: 0,
      blocks: projectServiceBlocks({ branch, firstRunId: first.id, live: false }),
      context: coldContextState(manager, window),
    };
  } catch (error) {
    ctx.log.warn('Cold transcript projection failed.', { taskId, error: errorMessage(error) });
    return { revision: 0, blocks: [], context: emptyContextState() };
  }
}

/** The catalog window of a run's model, for runs that froze none; null when unknown. */
async function catalogWindow(dataDir: string, model: ServiceModel): Promise<number | null> {
  const connections = await ConnectionStore.load(dataDir);
  const connection = connections.data.connections.find(
    (item) => item.connectionId === model.connectionId,
  );
  if (!connection) return null;
  const { catalog = [] } = await presentConnection(connection);
  return catalog.find((item) => item.id === model.modelId)?.contextWindow ?? null;
}

/**
 * The branch's last assistant message, a run's outcome. It is read from the raw branch, not the
 * model context: an overflow recovery that failed omits the failed attempt from context, and
 * the context's last response would then pass for the run's.
 */
export function lastAssistant(branch: readonly SessionEntry[]): AssistantMessage | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type === 'message' && entry.message.role === 'assistant') return entry.message;
  }
  return undefined;
}
