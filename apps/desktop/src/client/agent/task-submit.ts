import { runCommand, type AgentClientOptions } from '@atd/agent-client';
import { snapshotToolsFor } from '@atd/agent-contracts';
import type { AgentRequest, SubmitRequest, TaskDetail } from './bridge';
import type { CommandDefinition } from './command-schema';
import { stageRunChoices } from './run-staging';
import { notConnected } from './service-manage';
import type { TaskClient } from './service-tasks';
import { isActive } from './task-schema';

/** What submitting needs beyond the task cache: the connection and the command list. */
export interface SubmitContext {
  options: () => AgentClientOptions | null;
  findCommand: (id: string) => CommandDefinition;
}

/**
 * Starts a run, or queues a follow-up on the task's active run, and resolves with the task's
 * detail. `holder` is the view that submitted; it now shows the task, so its transcript stays
 * loaded (see `TaskClient.detail`). A saved command runs through the service's command launch.
 */
export async function submitTask<S>(
  tasks: TaskClient<S>,
  context: SubmitContext,
  request: Extract<AgentRequest, { action: 'submit' }>,
  holder?: S,
): Promise<TaskDetail> {
  const http = tasks.http();
  if (request.savedRun)
    throw new Error('Saved runs are unavailable until the service delivers commands (owner T2).');
  if (request.commandId)
    return runSavedCommand(tasks, context, request, context.findCommand(request.commandId), holder);
  const previous = request.taskId ? (tasks.entries.get(request.taskId)?.task ?? null) : null;
  const busy = previous?.runs.some((run) => isActive(run.status)) ?? false;
  // A replacement prompt branches the session, which only an idle task can do; queuing it as a
  // follow-up would append instead of replacing. (The service refuses one without `taskId`.)
  if (request.branchBefore && busy)
    throw new Error('Wait for the current run to finish before changing an earlier message.');
  if (busy && previous) {
    if (request.input.files.length || request.input.folders?.length)
      throw new Error('Attach files and folders after the run finishes.');
    // A queued follow-up is text only; it would silently drop the chips' references and skill.
    if (request.policy?.references?.length || request.policy?.skills?.length)
      throw new Error('Send mentions and skills after this run finishes.');
    const text = request.input.text.trim();
    if (!text) throw new Error('Enter a follow-up.');
    await http.queue(previous.id, { text, mode: 'followUp' });
    return tasks.detail(previous.id, holder);
  }
  const { text } = request.input;
  if (!text.trim() && !request.input.files.length)
    throw new Error('Enter a message or attach a file.');
  const taskId = await stageRunChoices(context.options(), request.taskId, request.policy);
  // Only a model picked for this run travels: the service selects the rest (`runModelSelection`),
  // so a follow-up stays on its last run's model as the picker shows. Without a policy the service
  // keeps the task's last tools and memory flag (or its defaults).
  const { policy } = request;
  const submitted = await http.submit({
    operationId: request.invocationId,
    ...(taskId ? { taskId } : {}),
    // Chip ranges index the submitted text. The array is always sent: without it the transcript
    // treats the run as sent before chips were recorded and shows a leading `/skill:` token as a
    // skill chip. Folders likewise: an absent list marks input stored before folders.
    input: {
      ...request.input,
      chips: request.input.chips ?? [],
      folders: request.input.folders ?? [],
    },
    ...(policy?.model ? { model: policy.model } : {}),
    ...(policy?.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
    ...(policy ? { tools: snapshotToolsFor(policy.tools), memory: policy.memory } : {}),
    ...(request.branchBefore ? { branchBefore: request.branchBefore } : {}),
    ...(request.sideChatOf ? { sideChatOf: request.sideChatOf } : {}),
  });
  return settled(tasks, submitted.taskId, holder);
}

/**
 * Runs a saved command through the service (`POST /v1/commands/:id/run`), which renders its
 * template, stages the skills and references it names, records its chips, marks the run as
 * command material and titles a new task after the command. The command must still be the one the
 * panel showed. A command run stages only its template's tokens: the panel sends no composer
 * chips with it, so the policy contributes its model, thinking level, tools and memory flag.
 */
async function runSavedCommand<S>(
  tasks: TaskClient<S>,
  context: SubmitContext,
  request: SubmitRequest,
  command: CommandDefinition,
  holder: S | undefined,
): Promise<TaskDetail> {
  if (!command.enabled || command.revision !== request.commandRevision)
    throw new Error('This command changed or was disabled. Review before running.');
  // A command run starts from its template, so it never replaces an earlier message.
  if (request.branchBefore) throw new Error('A command cannot replace an earlier message.');
  const options = context.options();
  if (!options) throw notConnected();
  const { policy } = request;
  const submitted = await runCommand(options, command.id, {
    operationId: request.invocationId,
    ...(request.taskId ? { taskId: request.taskId } : {}),
    input: request.input,
    ...(policy
      ? {
          policy: {
            tools: snapshotToolsFor(policy.tools),
            memory: policy.memory,
            ...(policy.model ? { model: policy.model } : {}),
            ...(policy.thinkingLevel ? { thinkingLevel: policy.thinkingLevel } : {}),
          },
        }
      : {}),
    ...(request.sideChatOf ? { sideChatOf: request.sideChatOf } : {}),
  });
  return settled(tasks, submitted.taskId, holder);
}

/** The submitted task's detail, after every client view hears of the change. */
async function settled<S>(tasks: TaskClient<S>, taskId: string, holder?: S): Promise<TaskDetail> {
  const detail = await tasks.detail(taskId, holder);
  tasks.host.broadcast();
  return detail;
}
