import { previewTask, type AgentClientOptions, type AgentHttpClient } from '@ai/agent-client';
import {
  snapshotToolsFor,
  type InvalidateFrame,
  type ServiceEvent,
  type TaskSnapshot,
} from '@ai/agent-contracts';
import type { AgentEvent, AgentRequest, TaskDetail } from './bridge';
import { ChildTranscripts } from './child-transcripts';
import type { CommandDefinition } from './command-schema';
import { commandRunChips, commandRunTokens, withCommandTokens } from './command-run';
import { stageRunChoices, type RunStaging } from './run-staging';
import { mapRunPolicy, notConnected, renameLiveTask } from './service-manage';
import { mapSnapshot } from './service-map';
import { applyTaskEvent } from './task-events';
import { isActive } from './task-schema';

/** The slice of a service connection the task cache uses; desktop and web both provide it. */
export interface TaskConnection {
  http(): AgentHttpClient | null;
  options(): AgentClientOptions | null;
  setTaskHandlers(handlers: {
    onSnapshot: (snapshot: TaskSnapshot) => void;
    onEvent: (event: ServiceEvent) => void;
  }): void;
}

export interface TaskHost {
  /** Delivers an event to every client view (all renderer windows, or the web page). */
  emit: (event: AgentEvent) => void;
  /** Republishes the agent snapshot (task list, commands). */
  broadcast: () => void;
  defaultModel: () => { connectionId: string; modelId: string } | undefined;
}

/**
 * Service task cache + submit/detail/events, shared by the desktop main process and the web
 * client. The service owns every task; this cache only mirrors the snapshots and events of the
 * shared stream, so a task another client creates, renames or deletes shows up here too.
 * `S` identifies who holds a subagent transcript (a window in the desktop, the page on the web).
 */
export class TaskClient<S> {
  readonly details = new Map<string, TaskDetail>();
  readonly revisions = new Map<string, { revision: number; taskId: string; runId: string }>();
  readonly children: ChildTranscripts<S>;
  /** Snapshot loads in flight, so a burst of events for an unknown task loads it once. */
  private readonly seeding = new Map<string, Promise<void>>();

  constructor(
    private readonly connection: TaskConnection,
    private readonly commands: { find: (id: string) => CommandDefinition },
    readonly host: TaskHost,
    forward: (subscriber: S, event: AgentEvent) => void,
  ) {
    this.children = new ChildTranscripts(() => this.http(), forward);
    connection.setTaskHandlers({
      onSnapshot: (snapshot) => void this.onSnapshot(snapshot),
      onEvent: (event) => void this.onEvent(event),
    });
  }

  tasks() {
    return [...this.details.values()]
      .map((detail) => detail.task)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  clear() {
    this.details.clear();
    this.revisions.clear();
    this.children.clear();
  }

  http() {
    const client = this.connection.http();
    if (!client) throw notConnected();
    return client;
  }

  async detail(taskId: string): Promise<TaskDetail> {
    const snapshot = await this.http().snapshot(taskId);
    return structuredClone(this.cacheSnapshot(snapshot.snapshot));
  }

  cacheSnapshot(snapshot: TaskSnapshot): TaskDetail {
    const detail = mapSnapshot(snapshot);
    for (const request of snapshot.requests)
      this.revisions.set(request.id, {
        revision: request.revision,
        taskId: request.taskId,
        runId: request.runId,
      });
    this.details.set(snapshot.task.id, detail);
    return detail;
  }

  publishTask(taskId: string) {
    const detail = this.details.get(taskId);
    if (!detail) return;
    this.host.emit({
      type: 'task',
      state: {
        task: detail.task,
        artifacts: detail.artifacts,
        requests: detail.requests,
        queue: detail.queue,
        context: detail.context,
      },
    });
    this.host.broadcast();
  }

  /** Reloads a task from its snapshot and republishes it whole, transcript included. */
  reseed(taskId: string): Promise<void> {
    let pending = this.seeding.get(taskId);
    if (pending) return pending;
    pending = this.detail(taskId)
      .then((detail) => {
        this.publishTask(taskId);
        this.host.emit({
          type: 'transcript',
          patch: {
            taskId,
            revision: detail.revision,
            snapshot: true,
            blocks: detail.blocks,
            removed: [],
          },
        });
      })
      .finally(() => this.seeding.delete(taskId));
    this.seeding.set(taskId, pending);
    return pending;
  }

  /** Another client (or this one) renamed, retiered or deleted a task. */
  async onInvalidate(frame: InvalidateFrame) {
    if (!frame.taskId) return;
    if (frame.scope === 'task.deleted') {
      this.details.delete(frame.taskId);
      this.children.forgetTask(frame.taskId);
      this.host.broadcast();
      return;
    }
    if (frame.scope === 'task') await this.reseed(frame.taskId).catch(() => undefined);
  }

  private async onSnapshot(snapshot: TaskSnapshot) {
    try {
      const detail = this.cacheSnapshot(snapshot);
      this.host.emit({
        type: 'task',
        state: {
          task: detail.task,
          artifacts: [],
          requests: detail.requests,
          queue: detail.queue,
          context: detail.context,
        },
      });
      this.host.broadcast();
    } catch {
      // Malformed snapshots never break the stream; detail() reseeds on demand.
    }
  }

  private async onEvent(event: ServiceEvent) {
    try {
      // A task this cache has not seen yet (created by another client, or before this client
      // connected): its snapshot already contains the event.
      if (!this.details.has(event.taskId)) return await this.reseed(event.taskId);
      await applyTaskEvent(this, event);
    } catch {
      // Stream events never throw; detail() reseeds on demand.
    }
  }

  async submit(request: Extract<AgentRequest, { action: 'submit' }>): Promise<TaskDetail> {
    const http = this.http();
    if (request.savedRun)
      throw new Error('Saved runs are unavailable until the service delivers commands (owner T2).');
    const command = request.commandId ? this.commands.find(request.commandId) : null;
    const tokens = command ? commandRunTokens(command) : null;
    const previous = request.taskId ? (this.details.get(request.taskId)?.task ?? null) : null;
    if (previous?.runs.some((run) => isActive(run.status))) {
      if (request.input.files.length) throw new Error('Attach files after the run finishes.');
      // A queued follow-up is text only; it would silently drop the chips' references and skill,
      // and a command template's tokens alike.
      if (request.policy?.references?.length || request.policy?.skills?.length || tokens?.keys.size)
        throw new Error('Send mentions and skills after this run finishes.');
      const text = request.input.text.trim();
      if (!text) throw new Error('Enter a follow-up.');
      await http.queue(previous.id, { text, mode: 'followUp' });
      return this.detail(previous.id);
    }
    let text = request.input.text;
    // Chip ranges index the submitted text. The array is always sent: without it the transcript
    // treats the run as sent before chips were recorded and shows a leading `/skill:` token as a
    // skill chip.
    let chips = request.input.chips ?? [];
    let staging: RunStaging | null = request.policy;
    let model = request.policy?.model ?? this.host.defaultModel();
    let thinkingLevel = request.policy?.thinkingLevel;
    // Without a policy the service keeps the task's last tools and memory flag (or its defaults).
    let tools = request.policy ? snapshotToolsFor(request.policy.tools) : undefined;
    let memory = request.policy?.memory;
    const options = this.connection.options();
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
        (taskId) => this.details.get(taskId)?.task.title || taskId,
      );
      staging = withCommandTokens(request.policy, tokens);
      if (!request.policy?.model)
        model = {
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
      input: { ...request.input, text, chips },
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      ...(tools ? { tools } : {}),
      ...(memory === undefined ? {} : { memory }),
    });
    // A command run is titled after the command. The title lives in the service like any rename,
    // so every client shows it.
    if (command && !request.taskId && options)
      await renameLiveTask(options, submitted.taskId, command.name);
    const detail = await this.detail(submitted.taskId);
    this.host.broadcast();
    return detail;
  }
}
