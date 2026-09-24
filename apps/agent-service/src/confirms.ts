import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type GrantScope,
  type PermissionAnswer,
  type PermissionRequest,
} from '@ai/agent-contracts';
import type { EventLog } from './event-log.js';
import { ConflictError } from './errors.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';

export interface ConfirmWaiter {
  resolve: (answer: PermissionAnswer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const CONFIRM_TTL_MS = 30 * 60 * 1000;

/**
 * Pending human-in-the-loop requests. Persisted in the ledger so a restart can
 * re-offer live requests; replies must match id + revision + kind.
 */
export class ConfirmStore {
  private readonly waiters = new Map<string, ConfirmWaiter>();
  /** Per task: whether the message the user cut in with is still undelivered. */
  private readonly interjections = new Map<string, () => boolean>();

  constructor(
    private readonly ledger: Ledger,
    private readonly events: EventLog,
    private readonly log: Logger,
  ) {}

  pending(): PermissionRequest[] {
    return [...this.ledger.data.pendingConfirms].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
  }

  forTask(taskId: string): PermissionRequest[] {
    return this.pending().filter((request) => request.taskId === taskId);
  }

  /**
   * Raises a confirmation/input request and waits for the reply. Disconnects do
   * not cancel the wait; abort (run cancel) and expiry reject it instead.
   */
  async request(draft: PermissionRequestDraft, signal?: AbortSignal): Promise<PermissionAnswer> {
    if (this.interjecting(draft.taskId)) return supersededAnswer(draft);
    const stamp = { id: randomUUID(), revision: 1, createdAt: new Date().toISOString() };
    const created: PermissionRequest =
      draft.kind === 'confirmation' ? { ...draft, ...stamp } : { ...draft, ...stamp };
    await this.ledger.change((data) => {
      data.pendingConfirms.push(created);
    });
    this.events.publish({
      taskId: created.taskId,
      runId: created.runId,
      executionId: created.executionId,
      type: 'confirm.requested',
      data: { request: created },
    });
    return new Promise<PermissionAnswer>((resolve, reject) => {
      const waiter: ConfirmWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => this.expire(created.id), CONFIRM_TTL_MS),
      };
      waiter.timer?.unref?.();
      this.waiters.set(created.id, waiter);
      signal?.addEventListener(
        'abort',
        () => {
          this.waiters.delete(created.id);
          if (waiter.timer) clearTimeout(waiter.timer);
          reject(new Error('Task stopped.'));
          // A subagent can abort while its parent run keeps going, so no cancelRun follows:
          // withdraw this one request here or the desktop keeps showing it until expiry.
          void this.withdraw(created);
        },
        { once: true },
      );
    });
  }

  /** Applies a client reply; stale revisions and kind mismatches are rejected. */
  async reply(requestId: string, revision: number, answer: PermissionAnswer): Promise<boolean> {
    const live = this.ledger.data.pendingConfirms.find((item) => item.id === requestId);
    if (!live) throw new ConfirmGone(requestId);
    if (live.revision !== revision)
      throw new ConflictError('The request changed. Refresh and answer the latest version.');
    if (live.kind === 'confirmation' && !('decision' in answer))
      throw new TypeError('Invalid data: this confirmation needs a decision.');
    if (live.kind === 'input' && !('answer' in answer) && !('skipped' in answer))
      throw new TypeError('Invalid data: this question needs a text answer.');
    return this.settle(live, answer);
  }

  /**
   * The user cut in with a message (a steer): it supersedes the task's human-in-the-loop pauses.
   * Pending requests resolve now — approvals declined, questions skipped — and while the message
   * is still undelivered, new ones resolve the same way without being raised. Pi delivers a steer
   * only after the current tool batch, so a later approval in that batch would otherwise hold
   * the message back.
   */
  async interject(taskId: string, undelivered: () => boolean): Promise<void> {
    this.interjections.set(taskId, undelivered);
    for (const request of this.forTask(taskId))
      await this.settle(request, supersededAnswer(request));
  }

  private interjecting(taskId: string): boolean {
    if (this.interjections.get(taskId)?.()) return true;
    this.interjections.delete(taskId);
    return false;
  }

  private async settle(live: PermissionRequest, answer: PermissionAnswer): Promise<boolean> {
    await this.ledger.change((data) => {
      data.pendingConfirms = data.pendingConfirms.filter((item) => item.id !== live.id);
    });
    const waiter = this.waiters.get(live.id);
    this.waiters.delete(live.id);
    if (waiter?.timer) clearTimeout(waiter.timer);
    this.events.publish({
      taskId: live.taskId,
      runId: live.runId,
      executionId: live.executionId,
      type: 'confirm.resolved',
      data: { requestId: live.id, outcome: outcomeOf(answer) },
    });
    waiter?.resolve(answer);
    return waiter !== undefined;
  }

  /** Removes one aborted request and tells clients it was cancelled; no-op once it is gone. */
  private async withdraw(request: PermissionRequest): Promise<void> {
    if (!this.ledger.data.pendingConfirms.some((item) => item.id === request.id)) return;
    try {
      await this.ledger.change((data) => {
        data.pendingConfirms = data.pendingConfirms.filter((item) => item.id !== request.id);
      });
    } catch (error) {
      this.log.warn('Confirm cancel write failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    this.events.publish({
      taskId: request.taskId,
      runId: request.runId,
      executionId: request.executionId,
      type: 'confirm.resolved',
      data: { requestId: request.id, outcome: 'cancelled' },
    });
  }

  /** Cancels every pending request of a run (stop/drain); late replies go `gone`. */
  async cancelRun(taskId: string, runId: string, reason: string): Promise<void> {
    const doomed = this.ledger.data.pendingConfirms.filter(
      (item) => item.taskId === taskId && item.runId === runId,
    );
    if (!doomed.length) return;
    const ids = new Set(doomed.map((item) => item.id));
    await this.ledger.change((data) => {
      data.pendingConfirms = data.pendingConfirms.filter((item) => !ids.has(item.id));
    });
    for (const request of doomed) {
      const waiter = this.waiters.get(request.id);
      this.waiters.delete(request.id);
      if (waiter?.timer) clearTimeout(waiter.timer);
      this.events.publish({
        taskId: request.taskId,
        runId: request.runId,
        executionId: request.executionId,
        type: 'confirm.resolved',
        data: { requestId: request.id, outcome: 'cancelled' },
      });
      waiter?.reject(new Error(reason));
    }
  }

  /** Revalidates persisted requests after a restart; expired ones resolve `gone`. */
  async recover(): Promise<{ kept: number; dropped: number }> {
    const now = Date.now();
    const kept: PermissionRequest[] = [];
    const dropped: PermissionRequest[] = [];
    for (const request of this.ledger.data.pendingConfirms) {
      const created = Date.parse(request.createdAt);
      if (Number.isNaN(created) || now - created > CONFIRM_TTL_MS) dropped.push(request);
      else kept.push(request);
    }
    if (dropped.length)
      await this.ledger.change((data) => {
        data.pendingConfirms = kept;
      });
    for (const request of dropped)
      this.events.publish({
        taskId: request.taskId,
        runId: request.runId,
        executionId: request.executionId,
        type: 'confirm.resolved',
        data: { requestId: request.id, outcome: 'expired' },
      });
    return { kept: kept.length, dropped: dropped.length };
  }

  private async expire(requestId: string): Promise<void> {
    const waiter = this.waiters.get(requestId);
    this.waiters.delete(requestId);
    const live = this.ledger.data.pendingConfirms.find((item) => item.id === requestId);
    if (!live) return;
    try {
      await this.ledger.change((data) => {
        data.pendingConfirms = data.pendingConfirms.filter((item) => item.id !== requestId);
      });
    } catch (error) {
      this.log.warn('Confirm expiry write failed.', { error: errorMessage(error) });
    }
    this.events.publish({
      taskId: live.taskId,
      runId: live.runId,
      executionId: live.executionId,
      type: 'confirm.resolved',
      data: { requestId, outcome: 'expired' },
    });
    waiter?.reject(new Error('The request expired.'));
  }
}

export class ConfirmGone extends Error {
  constructor(readonly requestId: string) {
    super('The request is no longer pending.');
    this.name = 'ConfirmGone';
  }
}

/** Distributive draft: plain Omit would collapse the union to common keys. */
type DraftOf<T> = T extends unknown ? Omit<T, 'id' | 'revision' | 'createdAt'> : never;
export type PermissionRequestDraft = DraftOf<PermissionRequest>;

/** How a request resolves when the user's interjection supersedes it. */
function supersededAnswer(request: { kind: PermissionRequest['kind'] }): PermissionAnswer {
  if (request.kind === 'confirmation') return { decision: 'declined' };
  return { skipped: true };
}

function outcomeOf(answer: PermissionAnswer): string {
  if ('decision' in answer) return answer.decision;
  if ('skipped' in answer) return 'skipped';
  return 'answered';
}

/** Read-only helper so tool proxies can name the scope they guard. */
export function describeScope(scope: GrantScope): string {
  return 'location' in scope ? `${scope.tool}:${scope.location}` : scope.tool;
}
