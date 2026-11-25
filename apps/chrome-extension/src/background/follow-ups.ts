/**
 * Save as automation (`run.followUp`) has no success answer: the shell reports only a failure,
 * as `error {ref: taskId}`. Follow-ups sent recently are kept by task id so that error reaches
 * the HUDs showing the run (`followUp.failed`) instead of the log; one that could not be sent at
 * all (the channel was not ready) fails there at once.
 */

/** How long a sent follow-up may still be refused (the shell answers in seconds). */
const ANSWER_MS = 2 * 60_000;

export class FollowUps {
  private readonly sentAt = new Map<string, number>();

  /** `failed` tells the HUDs showing the task's run that its follow-up did not reach Atd. */
  constructor(private readonly failed: (taskId: string) => void) {}

  sent(taskId: string): void {
    const now = Date.now();
    for (const [id, at] of this.sentAt) if (now - at > ANSWER_MS) this.sentAt.delete(id);
    this.sentAt.set(taskId, now);
  }

  /** The follow-up was not sent: the channel was not ready. */
  dropped(taskId: string): void {
    this.sentAt.delete(taskId);
    this.failed(taskId);
  }

  /** An `error` frame naming `ref`; true when it refused a pending follow-up. */
  refused(ref: string): boolean {
    const at = this.sentAt.get(ref);
    if (at === undefined) return false;
    this.sentAt.delete(ref);
    if (Date.now() - at > ANSWER_MS) return false;
    this.failed(ref);
    return true;
  }

  /** The channel closed: an error for a follow-up sent before can no longer arrive. */
  clear(): void {
    this.sentAt.clear();
  }
}
