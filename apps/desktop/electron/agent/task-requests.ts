import type { GrantScope, PermissionAnswer, PermissionRequest } from './permission-schema';
import { isActive, type RunStatus } from './task-schema';
import {
  applyTranscriptPatch,
  EMPTY_QUEUE,
  type Block,
  type QueueState,
  type TranscriptPatch,
} from './transcript-schema';
import type { TranscriptSnapshot } from './worker-contract';
import { errorMessage } from './validation';

export type ConfirmationReply = Extract<PermissionAnswer, { decision: unknown }>;
export type InputReply = Exclude<PermissionAnswer, { decision: unknown }>;

type PendingRequest = {
  request: PermissionRequest;
  resolve: (answer: PermissionAnswer) => void;
};

export function validatePermissionAnswer(request: PermissionRequest, answer: PermissionAnswer) {
  if (request.kind === 'confirmation') {
    if (!('decision' in answer))
      throw new Error('Choose allow once, allow for this session, or decline.');
    return;
  }
  if ('decision' in answer) throw new Error('Enter a response or skip this question.');
  if ('answer' in answer && !answer.answer.trim()) throw new Error('Enter a response.');
}

export function statusForPending(requests: PermissionRequest[]): RunStatus {
  const oldest = requests[0];
  if (!oldest) return 'running';
  return oldest.kind === 'input' ? 'awaiting_input' : 'awaiting_confirmation';
}

export function declinedReply(request: PermissionRequest): ConfirmationReply | InputReply {
  return request.kind === 'confirmation' ? { decision: 'declined' } : { skipped: true };
}

const LIVE = ['running', 'awaiting_input', 'awaiting_confirmation'] as const;
export function isLiveRun(status: string) {
  return (LIVE as readonly string[]).includes(status);
}

/** Queue requests need a Pi session that is prompting; a queued or stopping run has none to receive them. */
export function assertQueueable(status: RunStatus | undefined) {
  if (status === undefined || !isActive(status)) throw new Error('This task has no active run.');
  if (isLiveRun(status)) return;
  throw new Error(
    status === 'queued'
      ? 'Wait for the run to start before sending a follow-up.'
      : 'This run is stopping; send the message after it ends.',
  );
}

/** Every pending human request of the process, oldest-first in insertion order. */
export class TaskRequests {
  private readonly pending = new Map<string, PendingRequest>();

  get(id: string) {
    return this.pending.get(id);
  }

  add(request: PermissionRequest, resolve: (answer: PermissionAnswer) => void) {
    this.pending.set(request.id, { request, resolve });
  }

  delete(id: string) {
    return this.pending.delete(id);
  }

  resolve(id: string, answer: PermissionAnswer) {
    this.pending.get(id)?.resolve(answer);
  }

  list(taskId: string): PermissionRequest[] {
    return [...this.pending.values()]
      .filter((item) => item.request.taskId === taskId)
      .map((item) => item.request);
  }

  remaining(runId: string, exceptId?: string): PermissionRequest[] {
    return [...this.pending.values()]
      .filter((item) => item.request.runId === runId && item.request.id !== exceptId)
      .map((item) => item.request);
  }

  dismiss(runId: string) {
    this.release((item) => item.request.runId === runId);
  }

  forget(taskId: string) {
    this.release((item) => item.request.taskId === taskId);
  }

  private release(match: (item: PendingRequest) => boolean) {
    for (const [id, pending] of this.pending)
      if (match(pending)) {
        this.pending.delete(id);
        pending.resolve(declinedReply(pending.request));
      }
  }
}

export class TaskDocuments {
  private readonly documents = new Map<string, { revision: number; blocks: Block[] }>();
  private readonly queues = new Map<string, QueueState>();

  has(taskId: string) {
    return this.documents.has(taskId);
  }

  known(taskId: string) {
    return this.documents.has(taskId) || this.queues.has(taskId);
  }

  snapshot(taskId: string) {
    return this.documents.get(taskId) ?? { revision: 0, blocks: [] };
  }

  queue(taskId: string) {
    return this.queues.get(taskId) ?? EMPTY_QUEUE;
  }

  replace(taskId: string, document: { revision: number; blocks: Block[] }) {
    this.documents.set(taskId, document);
  }

  setQueue(taskId: string, queue: QueueState) {
    this.queues.set(taskId, queue);
  }

  resetQueue(taskId: string) {
    this.queues.set(taskId, EMPTY_QUEUE);
  }

  forget(taskId: string) {
    this.documents.delete(taskId);
    this.queues.delete(taskId);
  }

  async accept(
    patch: TranscriptPatch,
    reload: () => Promise<TranscriptSnapshot>,
  ): Promise<{ patch: TranscriptPatch; grants?: GrantScope[] } | { error: string }> {
    const current = this.documents.get(patch.taskId) ?? { revision: -1, blocks: [] };
    const next = applyTranscriptPatch(current, patch);
    if (next) {
      this.documents.set(patch.taskId, next);
      return { patch };
    }
    try {
      const snapshot = await reload();
      this.documents.set(patch.taskId, { revision: snapshot.revision, blocks: snapshot.blocks });
      return {
        patch: {
          taskId: patch.taskId,
          revision: snapshot.revision,
          snapshot: true,
          blocks: snapshot.blocks,
          removed: [],
        },
        grants: snapshot.grants,
      };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }
}
