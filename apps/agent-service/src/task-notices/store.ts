import { MAX_TASK_NOTICES, type TaskNotice } from '@atd/agent-contracts';

/**
 * Notices the shell has not read within this long are dropped, like automation notices; a
 * request served to the shell is forgotten this long after it was first served.
 */
export const TASK_NOTICE_TTL_MS = 60 * 60_000;

/** A `needs*` notice served to the shell: what a later `resolved` notice names. */
export interface ServedRequest {
  taskId: string;
  taskTitle: string;
  request: NonNullable<TaskNotice['request']>;
}

/**
 * The task notices nobody acknowledged yet, in memory only: a restart drops them, since the runs
 * and requests they describe end with the process anyway (recovery.ts). Each task holds at most one
 * notice, so a newer state of a task replaces the one the shell has not read, and the list keeps
 * the newest `MAX_TASK_NOTICES` younger than `TASK_NOTICE_TTL_MS`.
 *
 * It also remembers the requests whose `needs*` notice it served to the shell, because the shell
 * may have shown a notification for them that must be taken back when the request ends elsewhere.
 * A notice counts once it is listed, not only once it is acknowledged: the shell posts between the
 * two, so a request answered in that gap still owes a `resolved` notice. That memory holds at most
 * `MAX_TASK_NOTICES` requests (the oldest go first), and an entry goes when its request resolves
 * or `TASK_NOTICE_TTL_MS` after it was first served. Like the notices, it is lost on restart.
 */
export class TaskNoticeStore {
  /** Oldest first. */
  private notices: TaskNotice[] = [];
  /** Served requests by request id, in the order they were first served. */
  private readonly served = new Map<string, ServedRequest & { at: number }>();

  constructor(private readonly now: () => number) {}

  add(notice: TaskNotice): void {
    this.notices = this.notices.filter((item) => item.taskId !== notice.taskId);
    this.notices.push(notice);
    this.prune();
  }

  /**
   * The unacknowledged notices still worth posting, oldest first, for the shell: the requests of
   * the `needs*` ones among them are remembered from now on.
   */
  list(): TaskNotice[] {
    this.prune();
    const now = this.now();
    for (const notice of this.notices) {
      if (!notice.request || notice.kind === 'resolved') continue;
      if (this.served.has(notice.request.id)) continue;
      this.served.set(notice.request.id, {
        taskId: notice.taskId,
        taskTitle: notice.taskTitle,
        request: notice.request,
        at: now,
      });
    }
    this.prune();
    return [...this.notices];
  }

  /** Forgets the notices the shell read, shown or not; unknown ids are ignored. */
  ack(ids: readonly string[]): void {
    const read = new Set(ids);
    this.notices = this.notices.filter((notice) => !read.has(notice.id));
    this.prune();
  }

  /**
   * The request a `needs*` notice names was answered, withdrawn, expired or cancelled. An unread
   * notice for it is dropped. Returns the request when its notice was already served to the shell,
   * and forgets it: the caller owes the shell a `resolved` notice.
   */
  resolve(requestId: string): ServedRequest | null {
    this.notices = this.notices.filter(
      (notice) => notice.kind === 'resolved' || notice.request?.id !== requestId,
    );
    this.prune();
    const found = this.served.get(requestId);
    this.served.delete(requestId);
    if (!found) return null;
    const { taskId, taskTitle, request } = found;
    return { taskId, taskTitle, request };
  }

  private prune(): void {
    const now = this.now();
    this.notices = this.notices
      .filter((notice) => now - Date.parse(notice.createdAt) < TASK_NOTICE_TTL_MS)
      .slice(-MAX_TASK_NOTICES);
    for (const [requestId, item] of this.served) {
      if (now - item.at >= TASK_NOTICE_TTL_MS) this.served.delete(requestId);
    }
    // Map iteration is insertion order, so the oldest served requests go first.
    for (const requestId of this.served.keys()) {
      if (this.served.size <= MAX_TASK_NOTICES) break;
      this.served.delete(requestId);
    }
  }
}
