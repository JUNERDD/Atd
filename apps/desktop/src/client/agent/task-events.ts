import { TaskContextStateSchema, type ServiceEvent } from '@atd/agent-contracts';
import type { CachedTask, TaskClient } from './service-tasks';
import { mapBlock, mapRequest } from './service-map';
import { applyTranscriptPatch, QueueStateSchema, type TranscriptPatch } from './transcript-schema';
import { parse } from './validation';

/**
 * What applying an event's state to a cached task changed: its summary state (`task`), its
 * transcript (`patch`, to emit to the views), or nothing. `reload` means the event cannot apply:
 * the summary lacks what it refers to, or the patch does not follow the transcript's revision.
 */
type EventChange =
  | { kind: 'none' }
  | { kind: 'task' }
  | { kind: 'patch'; patch: TranscriptPatch }
  | { kind: 'reload'; scope: 'summary' | 'transcript' };

const NONE: EventChange = { kind: 'none' };
const TASK: EventChange = { kind: 'task' };

/**
 * Applies the task state one event carries to `task`, a cached task or one a load is bringing up
 * to the stream (`TaskClient` replays the events a load answered before). Only the state changes
 * here; the caller publishes it. Transcript and context events apply only while `task` has its
 * transcript. Events that carry no task state (`notice`, `child.transcript.patch`) are no-ops.
 * Answer revisions are not task state: `TaskClient` keeps them (`store`, `trackRevisions`).
 */
export function applyEventState(task: CachedTask, event: ServiceEvent): EventChange {
  const data = event.data as Record<string, unknown>;
  switch (event.type) {
    case 'run.status': {
      if (!event.runId) return NONE;
      const run = task.task.runs.find((item) => item.id === event.runId);
      // A run another client just submitted is not in the cached task yet.
      if (!run) return { kind: 'reload', scope: 'summary' };
      const status = data['status'] as typeof run.status;
      if (status) run.status = status;
      if (typeof data['error'] === 'string') run.error = data['error'];
      task.task.updatedAt = event.at;
      return TASK;
    }
    case 'transcript.patch': {
      const transcript = task.transcript;
      if (!transcript) return NONE;
      // A snapshot too large for the stream: its blocks come from the snapshot endpoint.
      if (data['reload'] === true) return { kind: 'reload', scope: 'transcript' };
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
      if (!next) return { kind: 'reload', scope: 'transcript' };
      transcript.revision = next.revision;
      transcript.blocks = next.blocks;
      return { kind: 'patch', patch };
    }
    case 'queue.update':
      // The service's only live queue signal: queued, delivered, replaced or withdrawn by Stop.
      task.queue = parse(QueueStateSchema, event.data);
      return TASK;
    case 'confirm.requested': {
      const request = mapRequest(data['request'] as Parameters<typeof mapRequest>[0]);
      if (task.requests.some((item) => item.id === request.id)) return NONE;
      task.requests.push(request);
      return TASK;
    }
    case 'confirm.resolved': {
      const requestId = typeof data['requestId'] === 'string' ? data['requestId'] : '';
      task.requests = task.requests.filter((item) => item.id !== requestId);
      return TASK;
    }
    case 'capability.requested':
    case 'capability.resolved':
      // The pending capabilities are part of the summary, which these events do not carry.
      return { kind: 'reload', scope: 'summary' };
    case 'context.update':
      // The whole state each time: after a turn, around a compaction, and on a model change.
      if (!task.transcript) return NONE;
      task.transcript.context = parse(TaskContextStateSchema, event.data);
      return TASK;
    case 'notice':
    case 'child.transcript.patch':
      return NONE;
    default: {
      const _exhaustive: never = event.type;
      throw new Error(`Unsupported service event: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Applies one stream event to a task the cache already has and publishes the change. A revision
 * gap reloads the transcript instead of guessing, and a run or capability the summary lacks
 * reloads the summary. Notices reach the views and child patches the views holding that child.
 */
export async function applyTaskEvent<S>(tasks: TaskClient<S>, event: ServiceEvent): Promise<void> {
  const data = event.data as Record<string, unknown>;
  if (event.type === 'child.transcript.patch') {
    tasks.children.onPatch(event.taskId, event.data);
    return;
  }
  if (event.type === 'notice') {
    const text = typeof data['text'] === 'string' ? data['text'] : '';
    const kind = data['kind'] === 'warning' || data['kind'] === 'error' ? data['kind'] : 'info';
    tasks.host.emit({ type: 'notice', notice: { taskId: event.taskId, text, kind } });
    return;
  }
  // A load answered after this event already holds its state (`TaskLoads`).
  if (tasks.loads.covers(event)) return;
  const cached = tasks.entries.get(event.taskId);
  if (!cached) return;
  const change = applyEventState(cached, event);
  switch (change.kind) {
    case 'none':
      return;
    case 'task':
      tasks.publishTask(event.taskId);
      return;
    case 'patch':
      tasks.host.emit({ type: 'transcript', patch: change.patch });
      return;
    case 'reload':
      return change.scope === 'summary'
        ? tasks.refreshSummary(event.taskId)
        : tasks.reloadTranscript(event.taskId);
  }
}
