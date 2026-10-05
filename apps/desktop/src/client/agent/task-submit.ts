import { previewTask, type AgentClientOptions } from '@atd/agent-client';
import { snapshotToolsFor } from '@atd/agent-contracts';
import type { AgentRequest, TaskDetail } from './bridge';
import type { CommandDefinition } from './command-schema';
import { commandRunChips, commandRunTokens, withCommandTokens } from './command-run';
import { stageRunChoices, type RunStaging } from './run-staging';
import { mapRunPolicy, notConnected, renameLiveTask } from './service-manage';
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
 * loaded (see `TaskClient.detail`).
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
  const command = request.commandId ? context.findCommand(request.commandId) : null;
  const tokens = command ? commandRunTokens(command) : null;
  const previous = request.taskId ? (tasks.entries.get(request.taskId)?.task ?? null) : null;
  const busy = previous?.runs.some((run) => isActive(run.status)) ?? false;
  // A replacement prompt branches the session, which only an idle task can do; queuing it as a
  // follow-up would append instead of replacing. (The service refuses one without `taskId`.)
  if (request.branchBefore && busy)
    throw new Error('Wait for the current run to finish before changing an earlier message.');
  if (busy && previous) {
    if (request.input.files.length || request.input.folders?.length)
      throw new Error('Attach files and folders after the run finishes.');
    // A queued follow-up is text only; it would silently drop the chips' references and skill,
    // and a command template's tokens alike.
    if (request.policy?.references?.length || request.policy?.skills?.length || tokens?.keys.size)
      throw new Error('Send mentions and skills after this run finishes.');
    const text = request.input.text.trim();
    if (!text) throw new Error('Enter a follow-up.');
    await http.queue(previous.id, { text, mode: 'followUp' });
    return tasks.detail(previous.id, holder);
  }
  let text = request.input.text;
  // Chip ranges index the submitted text. The array is always sent: without it the transcript
  // treats the run as sent before chips were recorded and shows a leading `/skill:` token as a
  // skill chip.
  let chips = request.input.chips ?? [];
  // Likewise always sent: an absent list marks input stored before folders.
  const folders = request.input.folders ?? [];
  let staging: RunStaging | null = request.policy;
  // Only a model picked for this run, or a command's, travels: the service selects the rest
  // (`runModelSelection`), so a follow-up stays on its last run's model as the picker shows.
  let model = request.policy?.model;
  let thinkingLevel = request.policy?.thinkingLevel;
  // Without a policy the service keeps the task's last tools and memory flag (or its defaults).
  let tools = request.policy ? snapshotToolsFor(request.policy.tools) : undefined;
  let memory = request.policy?.memory;
  const options = context.options();
  if (command && tokens) {
    if (!options) throw notConnected();
    if (!command.enabled || command.revision !== request.commandRevision)
      throw new Error('This command changed or was disabled. Review before running.');
    // The preview sees the request's policy unchanged; the template's tokens only add staging.
    const previewed = await previewTask(options, {
      commandId: command.id,
      input: request.input,
      ...(request.policy ? { policy: mapRunPolicy(request.policy) } : {}),
    });
    text = previewed.snapshot.instructions || previewed.snapshot.input.text || text;
    chips = commandRunChips(
      text,
      tokens,
      (taskId) => tasks.entries.get(taskId)?.task.title || taskId,
    );
    staging = withCommandTokens(request.policy, tokens);
    // The preview applied the command's fixed model, which submit cannot see on its own.
    model ??= {
      connectionId: previewed.snapshot.model.connectionId,
      modelId: previewed.snapshot.model.modelId,
    };
    thinkingLevel ??= previewed.snapshot.thinkingLevel;
    // The preview resolved the policy, else the command's own tools and memory setting.
    tools = previewed.snapshot.tools;
    memory = previewed.snapshot.memory;
  }
  if (!text.trim() && !request.input.files.length)
    throw new Error('Enter a message or attach a file.');
  const taskId = await stageRunChoices(options, request.taskId, staging);
  const submitted = await http.submit({
    operationId: request.invocationId,
    ...(taskId ? { taskId } : {}),
    input: { ...request.input, text, chips, folders },
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(tools ? { tools } : {}),
    ...(memory === undefined ? {} : { memory }),
    ...(request.branchBefore ? { branchBefore: request.branchBefore } : {}),
    ...(request.sideChatOf ? { sideChatOf: request.sideChatOf } : {}),
    // A command's text is its rendered template (above), which memory must never learn from.
    ...(command ? { fromCommand: true } : {}),
  });
  // A command run is titled after the command. The title lives in the service like any rename,
  // so every client shows it.
  if (command && !request.taskId && options)
    await renameLiveTask(options, submitted.taskId, command.name);
  const detail = await tasks.detail(submitted.taskId, holder);
  tasks.host.broadcast();
  return detail;
}
