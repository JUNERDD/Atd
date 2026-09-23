import { dialog } from 'electron';
import { extractSubagentResults, previewTask } from '@ai/agent-client';
import type { ServiceEvent, TaskSnapshot } from '@ai/agent-contracts';
import type { ServiceConnection } from '../service/connection';
import { ATTACHABLE_EXTENSIONS, attachFiles } from './attachable-files';
import type { AgentRequest, TaskDetail } from './bridge';
import type { CommandService } from './command-service';
import { AGENT_IPC } from './ipc-channels';
import { stageRunChoices } from './run-staging';
import { mapRunPolicy } from './service-manage';
import { isActive, type FileRef } from './task-schema';
import { applyTranscriptPatch, QueueStateSchema } from './transcript-schema';
import { mapBlock, mapRequest, mapSnapshot } from './service-map';
import { parse } from './validation';

interface TaskHost {
  send: (channel: string, value: unknown) => void;
  broadcast: () => void;
  defaultModel: () => { connectionId: string; modelId: string } | undefined;
}

/**
 * Service task cache + submit/detail/events. Owns the desktop TaskDetail map
 * populated from service snapshots/events; no Pi, worker or local runs.
 */
export class TaskClient {
  readonly details = new Map<string, TaskDetail>();
  readonly revisions = new Map<string, { revision: number; taskId: string; runId: string }>();

  constructor(
    private readonly connection: ServiceConnection,
    private readonly commands: CommandService,
    private readonly host: TaskHost,
  ) {
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
  }

  private http() {
    const client = this.connection.http();
    if (!client) throw new Error('The service is not connected. Connect in Settings → Service.');
    return client;
  }

  async detail(taskId: string): Promise<TaskDetail> {
    const snapshot = await this.http().snapshot(taskId);
    return structuredClone(this.cacheSnapshot(snapshot.snapshot));
  }

  cacheSnapshot(snapshot: TaskSnapshot): TaskDetail {
    const detail = mapSnapshot(snapshot);
    try {
      detail.children = extractSubagentResults(snapshot.blocks).map((result) => ({ ...result }));
    } catch {
      detail.children = [];
    }
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
    this.host.send(AGENT_IPC.changed, {
      type: 'task',
      state: {
        task: detail.task,
        artifacts: detail.artifacts,
        requests: detail.requests,
        queue: detail.queue,
      },
    });
    this.host.broadcast();
  }

  private async onSnapshot(snapshot: TaskSnapshot) {
    try {
      const detail = this.cacheSnapshot(snapshot);
      this.host.send(AGENT_IPC.changed, {
        type: 'task',
        state: { task: detail.task, artifacts: [], requests: detail.requests, queue: detail.queue },
      });
      this.host.broadcast();
    } catch {
      // Malformed snapshots never break the stream; detail() reseeds on demand.
    }
  }

  private async onEvent(event: ServiceEvent) {
    try {
      const data = event.data as Record<string, unknown>;
      switch (event.type) {
        case 'run.status': {
          const cached = this.details.get(event.taskId);
          if (!cached || !event.runId) return;
          const run = cached.task.runs.find((item) => item.id === event.runId);
          if (!run) return;
          const status = data['status'] as typeof run.status;
          if (status) run.status = status;
          if (typeof data['error'] === 'string') run.error = data['error'];
          cached.task.updatedAt = event.at;
          this.publishTask(event.taskId);
          return;
        }
        case 'transcript.patch': {
          const cached = this.details.get(event.taskId);
          if (!cached) return;
          const revision = typeof data['revision'] === 'number' ? data['revision'] : -1;
          const isSnapshot = data['snapshot'] === true;
          const blocks = Array.isArray(data['blocks']) ? data['blocks'] : [];
          const removed = Array.isArray(data['removed']) ? (data['removed'] as string[]) : [];
          const mapped = blocks.map((block) => mapBlock(block as Parameters<typeof mapBlock>[0]));
          const patch = {
            taskId: event.taskId,
            revision,
            snapshot: isSnapshot,
            blocks: mapped,
            removed,
          };
          const next = applyTranscriptPatch(
            { revision: cached.revision, blocks: cached.blocks },
            patch,
          );
          if (!next) {
            const fresh = await this.http().snapshot(event.taskId);
            const detail = this.cacheSnapshot(fresh.snapshot);
            this.host.send(AGENT_IPC.changed, {
              type: 'transcript',
              patch: {
                taskId: event.taskId,
                revision: detail.revision,
                snapshot: true,
                blocks: detail.blocks,
                removed: [],
              },
            });
            return;
          }
          cached.revision = next.revision;
          cached.blocks = next.blocks;
          this.host.send(AGENT_IPC.changed, { type: 'transcript', patch });
          return;
        }
        case 'queue.update': {
          // The service's only live queue signal: queued, delivered, replaced or withdrawn by Stop.
          const cached = this.details.get(event.taskId);
          if (!cached) return;
          cached.queue = parse(QueueStateSchema, event.data);
          this.publishTask(event.taskId);
          return;
        }
        case 'confirm.requested': {
          const raw = data['request'] as Parameters<typeof mapRequest>[0] & { revision: number };
          const request = mapRequest(raw);
          this.revisions.set(raw.id, {
            revision: raw.revision,
            taskId: raw.taskId,
            runId: raw.runId,
          });
          const cached = this.details.get(event.taskId);
          if (cached && !cached.requests.some((item) => item.id === request.id)) {
            cached.requests.push(request);
            this.publishTask(event.taskId);
          }
          return;
        }
        case 'confirm.resolved': {
          const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : '';
          this.revisions.delete(requestId);
          const cached = this.details.get(event.taskId);
          if (cached) {
            cached.requests = cached.requests.filter((item) => item.id !== requestId);
            this.publishTask(event.taskId);
          }
          return;
        }
        case 'capability.requested':
        case 'capability.resolved': {
          try {
            const fresh = await this.http().snapshot(event.taskId);
            this.cacheSnapshot(fresh.snapshot);
            this.publishTask(event.taskId);
          } catch {
            // Capability-only events never break task state.
          }
          return;
        }
        case 'notice': {
          const text = typeof data['text'] === 'string' ? data['text'] : '';
          const kind =
            data['kind'] === 'warning' || data['kind'] === 'error' ? data['kind'] : 'info';
          this.host.send(AGENT_IPC.changed, {
            type: 'notice',
            notice: { taskId: event.taskId, text, kind },
          });
          return;
        }
        default: {
          const _exhaustive: never = event.type;
          throw new Error(`Unsupported service event: ${String(_exhaustive)}`);
        }
      }
    } catch {
      // Stream events never throw; detail() reseeds on demand.
    }
  }

  async chooseFiles(): Promise<FileRef[]> {
    const http = this.http();
    const picked = await dialog.showOpenDialog({
      title: 'Attach text files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Text files', extensions: [...ATTACHABLE_EXTENSIONS] }],
    });
    if (picked.canceled) return [];
    return attachFiles(http, picked.filePaths);
  }

  async submit(request: Extract<AgentRequest, { action: 'submit' }>): Promise<TaskDetail> {
    const http = this.http();
    if (request.savedRun)
      throw new Error('Saved runs are unavailable until the service delivers commands (owner T2).');
    const previous = request.taskId ? (this.details.get(request.taskId)?.task ?? null) : null;
    if (previous?.runs.some((run) => isActive(run.status))) {
      if (request.input.files.length) throw new Error('Attach files after the run finishes.');
      // A queued follow-up is text only; it would silently drop the chips' references and skill.
      if (request.policy?.references?.length || request.policy?.skills?.length)
        throw new Error('Send mentions and skills after this run finishes.');
      const text = request.input.text.trim();
      if (!text) throw new Error('Enter a follow-up.');
      await http.queue(previous.id, { text, mode: 'followUp' });
      return this.detail(previous.id);
    }
    let text = request.input.text;
    let titleCommand: string | null = null;
    let model = request.policy?.model ?? this.host.defaultModel();
    let thinkingLevel = request.policy?.thinkingLevel;
    const options = this.connection.options();
    if (request.commandId) {
      if (!options) throw new Error('The service is not connected. Connect in Settings → Service.');
      const command = this.commands.find(request.commandId);
      if (!command.enabled || command.revision !== request.commandRevision)
        throw new Error('This command changed or was disabled. Review before running.');
      titleCommand = command.name;
      const previewed = await previewTask(options, {
        commandId: request.commandId,
        input: request.input,
        ...(request.policy ? { policy: mapRunPolicy(request.policy) } : {}),
      });
      text = previewed.snapshot.instructions || previewed.snapshot.input.text || text;
      if (!request.policy?.model)
        model = {
          connectionId: previewed.snapshot.model.connectionId,
          modelId: previewed.snapshot.model.modelId,
        };
      thinkingLevel ??= previewed.snapshot.thinkingLevel;
    }
    if (!text.trim() && !request.input.files.length)
      throw new Error('Enter a message or attach a file.');
    const taskId = await stageRunChoices(options, request.taskId, request.policy);
    // Chip ranges index the composed text, so a saved command's text gets none. The array is always
    // sent: without it the transcript treats the run as sent before chips were recorded and shows
    // a leading `/skill:` token as a skill chip.
    const { chips = [], ...input } = request.input;
    const submitted = await http.submit({
      operationId: request.invocationId,
      ...(taskId ? { taskId } : {}),
      input: { ...input, text, chips: text === request.input.text ? chips : [] },
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    });
    const detail = await this.detail(submitted.taskId);
    if (titleCommand && !request.taskId) detail.task.title = titleCommand;
    this.host.broadcast();
    return structuredClone(detail);
  }
}
