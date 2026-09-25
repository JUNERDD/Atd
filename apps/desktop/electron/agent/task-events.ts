import type { ServiceEvent } from '@ai/agent-contracts';
import type { TaskClient } from './service-tasks';
import { mapBlock, mapRequest } from './service-map';
import { applyTranscriptPatch, QueueStateSchema } from './transcript-schema';
import { parse } from './validation';

/**
 * Applies one stream event to a task the cache already holds and publishes the change. A
 * transcript revision gap reloads the task from its snapshot instead of guessing.
 */
export async function applyTaskEvent<S>(tasks: TaskClient<S>, event: ServiceEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;
  const cached = tasks.details.get(event.taskId);
  switch (event.type) {
    case 'run.status': {
      if (!cached || !event.runId) return;
      const run = cached.task.runs.find((item) => item.id === event.runId);
      // A run another client just submitted is not in the cached task yet.
      if (!run) return tasks.reseed(event.taskId);
      const status = data['status'] as typeof run.status;
      if (status) run.status = status;
      if (typeof data['error'] === 'string') run.error = data['error'];
      cached.task.updatedAt = event.at;
      tasks.publishTask(event.taskId);
      return;
    }
    case 'transcript.patch': {
      if (!cached) return;
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
      const next = applyTranscriptPatch(
        { revision: cached.revision, blocks: cached.blocks },
        patch,
      );
      if (!next) return tasks.reseed(event.taskId);
      cached.revision = next.revision;
      cached.blocks = next.blocks;
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
    case 'capability.resolved': {
      // Capability-only events never break task state.
      const fresh = await tasks
        .http()
        .snapshot(event.taskId)
        .catch(() => null);
      if (!fresh) return;
      tasks.cacheSnapshot(fresh.snapshot);
      tasks.publishTask(event.taskId);
      return;
    }
    case 'notice': {
      const text = typeof data['text'] === 'string' ? data['text'] : '';
      const kind = data['kind'] === 'warning' || data['kind'] === 'error' ? data['kind'] : 'info';
      tasks.host.emit({ type: 'notice', notice: { taskId: event.taskId, text, kind } });
      return;
    }
    default: {
      const _exhaustive: never = event.type;
      throw new Error(`Unsupported service event: ${String(_exhaustive)}`);
    }
  }
}
