import { TaskContextStateSchema, type ServiceEvent } from '@ai/agent-contracts';
import type { TaskClient } from './service-tasks';
import { mapBlock, mapRequest } from './service-map';
import { applyTranscriptPatch, QueueStateSchema } from './transcript-schema';
import { parse } from './validation';

/**
 * Applies one stream event to a task the cache already has and publishes the change. Transcript
 * and context events apply only to tasks a view has loaded; a revision gap reloads the transcript
 * instead of guessing, and a run or capability the summary lacks reloads the summary.
 */
export async function applyTaskEvent<S>(tasks: TaskClient<S>, event: ServiceEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const cached = tasks.entries.get(event.taskId);
  switch (event.type) {
    case 'run.status': {
      if (!cached || !event.runId) return;
      const run = cached.task.runs.find((item) => item.id === event.runId);
      // A run another client just submitted is not in the cached task yet.
      if (!run) return tasks.refreshSummary(event.taskId);
      const status = data['status'] as typeof run.status;
      if (status) run.status = status;
      if (typeof data['error'] === 'string') run.error = data['error'];
      cached.task.updatedAt = event.at;
      tasks.publishTask(event.taskId);
      return;
    }
    case 'transcript.patch': {
      const transcript = cached?.transcript;
      if (!transcript) return;
      const revision = typeof data['revision'] === 'number' ? data['revision'] : -1;
      const blocks = Array.isArray(data['blocks']) ? data['blocks'] : [];
      const removed = Array.isArray(data['removed']) ? (data['removed'] as string[]) : [];
      const patch = {
        taskId: event.taskId,
        revision,
        snapshot: data['snapshot'] === true,
        blocks: blocks.map((block) => mapBlock(block as Parameters<typeof mapBlock>[0])),
        removed,
      };
      const next = applyTranscriptPatch(transcript, patch);
      if (!next) return tasks.reloadTranscript(event.taskId);
      transcript.revision = next.revision;
      transcript.blocks = next.blocks;
      tasks.host.emit({ type: 'transcript', patch });
      return;
    }
    case 'child.transcript.patch':
      tasks.children.onPatch(event.taskId, event.data);
      return;
    case 'queue.update': {
      // The service's only live queue signal: queued, delivered, replaced or withdrawn by Stop.
      if (!cached) return;
      cached.queue = parse(QueueStateSchema, event.data);
      tasks.publishTask(event.taskId);
      return;
    }
    case 'confirm.requested': {
      const raw = data['request'] as Parameters<typeof mapRequest>[0] & { revision: number };
      const request = mapRequest(raw);
      tasks.revisions.set(raw.id, { revision: raw.revision, taskId: raw.taskId, runId: raw.runId });
      if (cached && !cached.requests.some((item) => item.id === request.id)) {
        cached.requests.push(request);
        tasks.publishTask(event.taskId);
      }
      return;
    }
    case 'confirm.resolved': {
      const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : '';
      tasks.revisions.delete(requestId);
      if (cached) {
        cached.requests = cached.requests.filter((item) => item.id !== requestId);
        tasks.publishTask(event.taskId);
      }
      return;
    }
    case 'capability.requested':
    case 'capability.resolved':
      // The pending capabilities are part of the summary. Capability-only events never break
      // task state.
      return tasks.refreshSummary(event.taskId).catch(() => undefined);
    case 'notice': {
      const text = typeof data['text'] === 'string' ? data['text'] : '';
      const kind = data['kind'] === 'warning' || data['kind'] === 'error' ? data['kind'] : 'info';
      tasks.host.emit({ type: 'notice', notice: { taskId: event.taskId, text, kind } });
      return;
    }
    case 'context.update': {
      // The whole state each time: after a turn, around a compaction, and on a model change.
      if (!cached?.transcript) return;
      cached.transcript.context = parse(TaskContextStateSchema, event.data);
      tasks.publishTask(event.taskId);
      return;
    }
    default: {
      const _exhaustive: never = event.type;
      throw new Error(`Unsupported service event: ${String(_exhaustive)}`);
    }
  }
}
