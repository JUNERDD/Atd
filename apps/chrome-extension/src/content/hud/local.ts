import type { RunStatus, RunView } from '../../channel/payloads.ts';
import { ENDED_RUN_STATUSES } from '../../messages/views.ts';

/** How long Stop shows `stopping` before the shell confirms; after that the shell's status rules. */
const STOP_OVERLAY_MS = 5000;
/** The spinner appears once stopping has taken this long. */
export const STOP_SPINNER_MS = 400;
/** An answer's buttons wait this long for the state that settles it. */
const ANSWER_WAIT_MS = 10_000;

/** Statuses a Stop press may cover with `stopping` until the shell catches up. */
const STOPPABLE: ReadonlySet<RunStatus> = new Set(['working', 'attention', 'held']);

/** Whether a run has ended (its HUD offers Dismiss). */
export function isTerminal(status: RunStatus): boolean {
  return ENDED_RUN_STATUSES.includes(status);
}

/** Save as automation: not asked, on its way to Atd ("Sent to Atd"), or it did not get there. */
export type FollowUpState = 'none' | 'sent' | 'failed';

/**
 * What this tab adds to the shell's runs: dismissals (per run, local), the moment Stop was
 * pressed, Save as automation sent, an answer on its way, a card the page covered and a copied
 * reply. The shell's next `runs` frame stays the truth.
 */
export class RunOverlays {
  private readonly dismissed = new Set<string>();
  private readonly stoppedAt = new Map<string, number>();
  /** Save as automation per run, with the task the shell reports a failure for. */
  private readonly followUps = new Map<string, { taskId: string; state: FollowUpState }>();
  private answer: { requestId: string; revision: number; at: number } | null = null;
  private coveredCard: string | null = null;
  private copiedRun: string | null = null;

  dismiss(run: RunView): void {
    this.dismissed.add(run.runId);
  }

  /** A dismissal only hides a run that has ended; a run that comes back to life shows again. */
  isDismissed(run: RunView): boolean {
    return this.dismissed.has(run.runId) && isTerminal(run.status);
  }

  stop(run: RunView, now: number): void {
    if (!this.stoppedAt.has(run.runId)) this.stoppedAt.set(run.runId, now);
  }

  /** The status to show: right after Stop, `stopping` until the shell says otherwise. */
  status(run: RunView, now: number): RunStatus {
    const at = this.stoppedAt.get(run.runId);
    if (at === undefined) return run.status;
    if (STOPPABLE.has(run.status) && now - at < STOP_OVERLAY_MS) return 'stopping';
    return run.status;
  }

  /** When stopping started, as the person saw it (their press, or the shell's first report). */
  stoppingSince(run: RunView, now: number): number {
    const at = this.stoppedAt.get(run.runId);
    if (at !== undefined) return at;
    this.stoppedAt.set(run.runId, now);
    return now;
  }

  sentFollowUp(run: RunView): void {
    this.followUps.set(run.runId, { taskId: run.taskId, state: 'sent' });
  }

  /** `followUp.failed`: the task's request did not reach Atd; returns whether one was shown. */
  failedFollowUp(taskId: string): boolean {
    let changed = false;
    for (const followUp of this.followUps.values()) {
      if (followUp.taskId !== taskId || followUp.state !== 'sent') continue;
      followUp.state = 'failed';
      changed = true;
    }
    return changed;
  }

  followUp(run: RunView): FollowUpState {
    return this.followUps.get(run.runId)?.state ?? 'none';
  }

  /** A guarded answer was refused because the page covered the card (`guard`). */
  cover(card: string | null): void {
    this.coveredCard = card;
  }

  isCovered(card: string | null): boolean {
    return card !== null && this.coveredCard === card;
  }

  answering(requestId: string, revision: number, now: number): void {
    this.answer = { requestId, revision, at: now };
  }

  /** Whether the request shown is the one just answered (its buttons then wait). */
  isAnswering(run: RunView, now: number): boolean {
    const answer = this.answer;
    if (!answer || now - answer.at > ANSWER_WAIT_MS) return false;
    const shown = run.requests[0];
    return shown?.requestId === answer.requestId && shown.revision === answer.revision;
  }

  /** When the pending answer stops holding its buttons, or null without one. */
  answerExpiry(): number | null {
    return this.answer ? this.answer.at + ANSWER_WAIT_MS : null;
  }

  copied(run: RunView | null): void {
    this.copiedRun = run?.runId ?? null;
  }

  wasCopied(run: RunView): boolean {
    return this.copiedRun === run.runId;
  }
}

/** Re-render deadlines the overlays imply for `run`: the spinner, the Stop and answer timeouts. */
export function overlayDeadlines(run: RunView, overlays: RunOverlays, now: number): number[] {
  const since = overlays.status(run, now) === 'stopping' ? overlays.stoppingSince(run, now) : null;
  const deadlines: number[] = [];
  if (since !== null) {
    deadlines.push(since + STOP_SPINNER_MS);
    if (run.status !== 'stopping') deadlines.push(since + STOP_OVERLAY_MS);
  }
  const expiry = overlays.answerExpiry();
  if (expiry !== null && overlays.isAnswering(run, now)) deadlines.push(expiry);
  return deadlines.filter((deadline) => deadline > now);
}
