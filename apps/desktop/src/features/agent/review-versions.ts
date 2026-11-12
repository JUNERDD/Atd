import type { TaskDetail } from '../../client/agent/bridge';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import { MAX_REVIEW_VERSIONS } from '../../native-bridge/command-review';
import { stopRun } from './light-command-run';
import type { ReviewPendingKind as PendingKind } from './review-card';
import { adjustPlan, versionRequest, type VersionPlan } from './light-review-request';
import type {
  Pending,
  Review,
  ReviewHost,
  ReviewPress,
  ReviewVersion,
  ReviewedRun,
} from './review-model';
import { streamThrottle } from './stream-throttle';
import { lastAnswerText } from './transcript/final-answer';

export type { Review, ReviewHost, ReviewPress, ReviewVersion, ReviewedRun };

/** Whether a run of the review is still going, or a submit of it is still in flight. */
function busy<R extends ReviewedRun>(host: ReviewHost<R>, review: Review): boolean {
  const runId = review.pending?.runId;
  return (
    review.starting > 0 ||
    review.draining.size > 0 ||
    (typeof runId === 'string' && host.going(runId))
  );
}

function showReview<R extends ReviewedRun>(host: ReviewHost<R>, run: R, failed = false): void {
  const review = run.review;
  if (review?.versions[review.shown] && host.live(run)) host.show(run, review, failed);
}

/**
 * Starts the review of a run whose first answer came (its own run, `runId`): the card shows the
 * answer as the first version, and the task stays held for the versions to come.
 */
export function beginReview<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  runId: string,
  answer: string,
): void {
  run.review = {
    versions: [{ runId, answer, values: run.launch.input.arguments }],
    shown: 0,
    pending: null,
    showsPending: false,
    paced: streamThrottle(),
    draining: new Set(),
    starting: 0,
    lastRunId: runId,
    closed: false,
  };
  showReview(host, run);
}

/**
 * No version is pending any more: its page goes, the card going back to the kept version it
 * showed last (unless the caller shows the version that came), and its answer streams no more.
 */
function clearPending(review: Review): void {
  review.pending = null;
  review.showsPending = false;
  review.paced.cancel();
}

/**
 * The pending version is no longer waited for; its run, if it has one, stops and is no longer
 * the run the card follows, so asking the person something on its way out opens nothing.
 */
function dropPending(run: ReviewedRun, review: Review): void {
  const { pending } = review;
  clearPending(review);
  if (!pending?.runId || !run.taskId) return;
  if (run.runId === pending.runId) run.runId = null;
  stopRun(run.taskId, pending.runId);
  review.draining.add(pending.runId);
}

/** Starts the pending version once the task has nothing of the review going. */
function advance<R extends ReviewedRun>(host: ReviewHost<R>, run: R, review: Review): void {
  const { pending } = review;
  if (!pending || pending.started || busy(host, review) || !host.live(run)) return;
  submitVersion(host, run, review, pending).catch((error: unknown) => {
    console.error('The new version did not start:', error);
  });
}

/**
 * Whether the review is no longer its card's (the card closed, a newer launch replaced it, or
 * the panel took it over); its task is then let go once nothing of it is going. Every run's end
 * and every submit's answer pass here, so the hold goes exactly once, after the last of them: a
 * submit in flight holds the task again as it answers, so the hold cannot go before it.
 */
function offCard<R extends ReviewedRun>(host: ReviewHost<R>, run: R, review: Review): boolean {
  if (!run.cancelled && !run.handedOver) return false;
  if (!busy(host, review)) host.letGo(run);
  return true;
}

/**
 * A version could not start: when the card still waits for it, the card says so on the version it
 * showed; else the version that replaced it may start now.
 */
function refuse<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  review: Review,
  pending: Pending,
): void {
  const wanted = review.pending === pending;
  if (wanted) clearPending(review);
  if (offCard(host, run, review)) return;
  if (wanted) showReview(host, run, true);
  else advance(host, run, review);
}

async function submitVersion<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  review: Review,
  pending: Pending,
): Promise<void> {
  const { taskId } = run;
  if (!taskId) return refuse(host, run, review, pending);
  pending.started = true;
  review.starting += 1;
  let detail: TaskDetail;
  try {
    detail = await host.submit(run, versionRequest(run.launch, taskId, pending.plan));
  } catch (error) {
    console.error('The new version did not start:', error);
    review.starting -= 1;
    return refuse(host, run, review, pending);
  }
  review.starting -= 1;
  const started = detail.task.runs.at(-1);
  if (!started || started.id === review.lastRunId) return refuse(host, run, review, pending);
  const active = isActive(started.status);
  host.started(run, detail, started.id, active, (text) =>
    streamVersion(host, run, review, started.id, text),
  );
  review.lastRunId = started.id;
  if (run.cancelled || review.pending !== pending) {
    // The review ended, or the version was stopped or replaced while it was starting.
    if (active) {
      stopRun(taskId, started.id);
      review.draining.add(started.id);
    }
    if (!offCard(host, run, review)) advance(host, run, review);
    return;
  }
  pending.runId = started.id;
  if (run.handedOver) {
    // It goes on in the panel; its end lets the task go.
    if (!active) clearPending(review);
    offCard(host, run, review);
    return;
  }
  run.runId = started.id;
  host.follow(run, detail);
  if (!active)
    settleReviewRun(
      host,
      run,
      started.id,
      started.status,
      lastAnswerText(detail.blocks, started.id),
    );
}

/**
 * The pending version's answer grew (`ReviewHost.started`'s `text`): while the card is on its
 * page, the page shows the answer so far, at most once per `STREAM_INTERVAL_MS`. A run no longer
 * the pending version's (stopped, replaced) streams nothing.
 */
function streamVersion<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  review: Review,
  runId: string,
  text: string,
): void {
  const { pending } = review;
  if (pending?.runId !== runId || review.closed) return;
  pending.text = text;
  if (review.showsPending) review.paced.push(() => showReview(host, run));
}

/**
 * Asks for a new version made as `plan` says, which the card shows at once as the page after the
 * kept ones, its answer streaming in. One already pending is replaced: its run stops, and the new
 * one starts once that run has ended. A review with every version it keeps makes no more, and the
 * card shows what it showed.
 */
function request<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  review: Review,
  kind: PendingKind,
  plan: VersionPlan,
): void {
  if (review.versions.length >= MAX_REVIEW_VERSIONS) return showReview(host, run);
  dropPending(run, review);
  review.pending = { kind, plan, started: false, runId: null, text: '' };
  review.showsPending = true;
  showReview(host, run);
  advance(host, run, review);
}

/**
 * A run of the review ended: in a review no longer its card's it may let the task go
 * (`offCard`); a stopped one lets the next version start; the pending version's answer becomes
 * the newest version, which the card shows when it was on its page (it stays on a kept version
 * the person paged back to), or the card says the version failed and goes back to the kept
 * version it showed last.
 */
export function settleReviewRun<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  runId: string,
  status: RunStatus,
  answer: string,
): void {
  const review = run.review;
  if (!review) return;
  const dropped = review.draining.delete(runId);
  if (offCard(host, run, review)) return;
  if (dropped) return advance(host, run, review);
  const { pending, showsPending } = review;
  if (pending?.runId !== runId) return;
  clearPending(review);
  if (status !== 'completed' || !answer) return showReview(host, run, true);
  review.versions.push({ runId, answer, values: pending.plan.values });
  if (showsPending) review.shown = review.versions.length - 1;
  showReview(host, run);
}

/**
 * The review card went by itself (closed, copied or applied), or a newer launch replaced it: the
 * pending version stops, and the task is let go once nothing of the review is going (`offCard`).
 * Its runs still going end quietly.
 */
export function closeReview<R extends ReviewedRun>(host: ReviewHost<R>, run: R): void {
  const review = run.review;
  if (!review || review.closed) return;
  review.closed = true;
  run.cancelled = true;
  dropPending(run, review);
  offCard(host, run, review);
}

/**
 * The panel took the review over (Open, or a version asked the person something): a version not
 * started yet is dropped, and the task is let go once nothing of the review is still going, the
 * panel holding it from now on; a version going on ends in the panel.
 */
export function handReviewOver<R extends ReviewedRun>(host: ReviewHost<R>, run: R): void {
  const review = run.review;
  if (!review) return;
  if (review.pending?.started === false) clearPending(review);
  offCard(host, run, review);
}

/**
 * A press on the review card: `version` shows a kept version, or the pending version's page after
 * them; `regenerate` runs the command again with the shown version's values; `adjust` makes the
 * version the card staged (`adjustPlan`); `stop` stops the pending version and shows the card
 * without it; `close` ends the review. Any other press (Open, and the other cards' presses) is not
 * the review's.
 */
export function actOnReview<R extends ReviewedRun>(
  host: ReviewHost<R>,
  run: R,
  press: ReviewPress,
): void {
  const review = run.review;
  const base = review?.versions[review.shown];
  if (!review || !base || review.closed) return;
  switch (press.action) {
    case 'version': {
      const index = (press.version ?? 0) - 1;
      const kept = index >= 0 && index < review.versions.length;
      if (!kept && !(review.pending && index === review.versions.length)) return;
      review.showsPending = !kept;
      if (kept) review.shown = index;
      return showReview(host, run);
    }
    case 'regenerate':
      return request(host, run, review, 'regenerate', { kind: 'command', values: base.values });
    case 'adjust': {
      if (!press.adjust) return;
      const latest = base.runId === review.lastRunId;
      const next = adjustPlan(run.launch.command, base, latest, press.adjust);
      if (!next) return showReview(host, run);
      return request(host, run, review, next.kind, next.plan);
    }
    case 'stop':
      dropPending(run, review);
      return showReview(host, run);
    case 'close':
      return closeReview(host, run);
    default:
      return;
  }
}
