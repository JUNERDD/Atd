import {
  DEFAULT_RUN_TOOLS,
  type AgentTask,
  type ModelSelection,
  type RunSnapshot,
  type ServiceBlock,
  type SubmitTaskRequest,
  type TaskRun,
} from '@atd/agent-contracts';
import type { ConnectionStore } from '../credentials/connections.js';
import type { RunnerContext, TaskRunner } from '../task-runner.js';
import { taskView } from '../task-view.js';
import { CONTEXT_BUDGET, runInputSize } from './run-budget.js';
import {
  loadRunContextWindow,
  resolveRunModel,
  resolveRunThinkingLevel,
  selectRunModel,
  type RunContextWindow,
} from './run-selection.js';

/**
 * Loads the context window of the model `freezeRunSnapshot` selects for the request, before
 * acceptance so the freeze stays synchronous. `last` is the task's last run, as the freeze reads it.
 */
export function loadSubmitContextWindow(
  connections: ConnectionStore,
  request: SubmitTaskRequest,
  last: TaskRun | undefined,
): Promise<RunContextWindow> {
  return loadRunContextWindow(connections, submitModelSelection(connections, request, last));
}

/**
 * The model selection a submit freezes: the requested model, else the model of the task's last run,
 * so a follow-up stays on the model the panel's picker shows; undefined means the default. A
 * command's fixed model arrives as the requested one, since submit does not know the command.
 */
function submitModelSelection(
  connections: ConnectionStore,
  request: SubmitTaskRequest,
  last: TaskRun | undefined,
): ModelSelection | undefined {
  return selectRunModel(connections, {
    requested: request.model ?? null,
    last: last?.snapshot.model ?? null,
  });
}

/**
 * Freezes an accepted request into its run snapshot. The model, tools and memory come from the
 * request, else carry over from the task's last run (a command that turned memory off keeps it off
 * for the task's follow-ups), else the defaults. The context window freezes like the thinking
 * level: later tier changes never reach an accepted run. A snapshot over the context budget is
 * refused. `task` is the task the run joins, null for a new one, and `onBranch` its user messages
 * as `branchUserEntries` read them.
 */
export function freezeRunSnapshot(
  request: SubmitTaskRequest,
  connections: ConnectionStore,
  contextWindowOf: RunContextWindow,
  task: AgentTask | null,
  onBranch: BranchUserEntries | null,
): RunSnapshot {
  const last = task?.runs.at(-1);
  const model = resolveRunModel(connections, submitModelSelection(connections, request, last));
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
    ...(isFromCommand(request, task, onBranch) ? { fromCommand: true } : {}),
  };
  if (runInputSize(snapshot) > CONTEXT_BUDGET)
    throw new Error('The combined input and parameters exceed the context budget.');
  return snapshot;
}

/**
 * Whether the run's prompt is command material (`RunSnapshot.fromCommand`): the client launched a
 * saved command, or the prompt replaces a command run's prompt (edit and resend, regenerate), which
 * the client submits as plain text built from that run's input. A replaced queued follow-up was the
 * user's own words, whichever run it joined.
 */
function isFromCommand(
  request: SubmitTaskRequest,
  task: AgentTask | null,
  onBranch: BranchUserEntries | null,
): boolean {
  if (request.fromCommand) return true;
  const prompted = request.branchBefore && onBranch?.get(request.branchBefore);
  if (!prompted) return false;
  return task?.runs.find((run) => run.id === prompted)?.snapshot.fromCommand === true;
}

/**
 * A task's user message entries on its current branch, as its transcript shows them, each mapped
 * to the run whose prompt it is, or to undefined for a queued steer or follow-up.
 */
export type BranchUserEntries = ReadonlyMap<string, string | undefined>;

/**
 * The user message entries a request's `branchBefore` may name: those its task's transcript
 * shows, live (through the task's runner) or read from the session file; null when it replaces
 * nothing.
 */
export async function branchUserEntries(
  ctx: RunnerContext,
  runner: TaskRunner | undefined,
  request: SubmitTaskRequest,
): Promise<BranchUserEntries | null> {
  const { taskId, branchBefore } = request;
  if (branchBefore === undefined) return null;
  if (!taskId || !ctx.ledger.data.tasks.some((task) => task.id === taskId))
    throw new TypeError('Invalid data: branchBefore needs an existing task.');
  const view = await taskView(ctx, runner, taskId);
  return userEntries(view.blocks);
}

/** The user messages a task's transcript shows, by session entry (`entryId`). */
function userEntries(blocks: readonly ServiceBlock[]): Map<string, string | undefined> {
  const entries = new Map<string, string | undefined>();
  for (const block of blocks)
    if (block.kind === 'user' && block.entryId)
      entries.set(block.entryId, block.prompt ? block.runId : undefined);
  return entries;
}

/**
 * Refuses a `branchBefore` that is not one of `onBranch`, the task's user message entries as its
 * transcript showed them at acceptance. Execution checks the entry again on the session itself.
 */
export function checkBranchBefore(
  branchBefore: string | undefined,
  onBranch: BranchUserEntries | null,
): void {
  if (branchBefore !== undefined && !onBranch?.has(branchBefore))
    throw new TypeError(
      "Invalid data: the message to replace is not a user message on the task's current branch.",
    );
}
