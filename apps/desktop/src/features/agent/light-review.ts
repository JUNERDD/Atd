import type {
  CommandProgressAction,
  CommandProgressState,
  TaskDetail,
} from '../../client/agent/bridge';
import { commandOptions, valuesSummary } from '../../client/agent/command-arguments';
import type { ArgumentValues } from '../../client/agent/command-schema';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import i18n from '../../i18n';
import { MAX_REVIEW_VERSIONS } from '../../native-bridge/command-review';
import { trackCommandRun } from './command-results';
import {
  letGo,
  lightBridge,
  lightRuns,
  showHud,
  stopRun,
  type LightRun,
} from './light-command-run';
import { reviewChanges, type ReviewChange } from './light-review-changes';
import { adjustPlan, versionRequest, type VersionPlan } from './light-review-request';
import { lastAnswerText } from './transcript/final-answer';

type ReviewState = NonNullable<Extract<CommandProgressState, { phase: 'answer' }>['review']>;
type PendingKind = NonNullable<ReviewState['pending']>;

/** One kept answer of a review, made by one run of its task. */
interface ReviewVersion {
  runId: string;
  answer: string;
  /** The option values it ran with, which the card shows and its next version starts from. */
  values: ArgumentValues;
  /** The answer marked against the source when it rewrote it (`reviewChanges`). */
  changes: ReviewChange[] | undefined;
}

/** The version being made, which the card shows as pending until it comes or is stopped. */
interface Pending {
  kind: PendingKind;
  plan: VersionPlan;
  /** Its submit was sent; `runId` names its run once the submit answered. */
  started: boolean;
  runId: string | null;
}

/**
 * The review of a light run whose answer waits for it (`output.review`): its versions, each a
 * run in the launch's task, which stays held while the review card shows. The task runs one run
 * at a time, so a new version starts only once no stopped run of it is still going (`draining`)
 * and no submit is still in flight (`starting`).
 */
export interface Review {
  versions: ReviewVersion[];
  /** The index of the version the card shows. */
  shown: number;
  pending: Pending | null;
  /** Runs stopped or replaced while the page no longer waits for them, until they end. */
  draining: Set<string>;
  starting: number;
  /** The task's newest run: a follow-up adjusts its answer unless it quotes another. */
  lastRunId: string;
  /** The card went (`close`), or a newer launch replaced it: the task is let go. */
  closed: boolean;
}

/** The text the run read in place of the selection, which the card shows as the original. */
function source(run: LightRun): string | undefined {
  const { selection } = run.launch.input;
  return selection.trim() ? selection : undefined;
}

function version(run: LightRun, runId: string, answer: string, values: ArgumentValues) {
  return { runId, answer, values, changes: reviewChanges(source(run), answer) };
}

/** Whether a run of the review is still going, or a submit of it is still in flight. */
function busy(review: Review): boolean {
  const runId = review.pending?.runId;
  return (
    review.starting > 0 ||
    review.draining.size > 0 ||
    (typeof runId === 'string' && lightRuns.holding.has(runId))
  );
}

/** Whether the run's review card is the HUD on screen and still the page's to answer. */
function live(run: LightRun): boolean {
  return (
    lightRuns.current === run && !run.cancelled && !run.handedOver && run.review?.closed === false
  );
}

/**
 * Shows the version the card is on, as the review card (`commandProgress.show`'s `answer` with
 * `review`): the source and the answer's changes, which version of how many, the command's
 * options with that version's values, its adjustments, and what is pending. `note` says why the
 * latest attempt made no version.
 */
function showReview(run: LightRun, note?: string): void {
  const review = run.review;
  const shown = review?.versions[review.shown];
  if (!review || !shown || !live(run)) return;
  const { command } = run.launch;
  const original = source(run);
  const summary = valuesSummary(command, shown.values);
  showHud(run, {
    phase: 'answer',
    command: command.name,
    answer: shown.answer,
    ...(note ? { note } : {}),
    review: {
      ...(original ? { source: original } : {}),
      ...(shown.changes ? { changes: shown.changes } : {}),
      version: review.shown + 1,
      count: review.versions.length,
      options: commandOptions(command, shown.values),
      ...(summary ? { summary } : {}),
      adjustments: command.adjustments ?? [],
      ...(review.pending ? { pending: review.pending.kind } : {}),
    },
  });
}

function failed(run: LightRun): string {
  return i18n.t('tasks:commandOutput.review.failed', { command: run.launch.command.name });
}

/**
 * Starts the review of a light run whose first answer came (its own run, `runId`): the card shows
 * the answer as the first version, and the task stays held for the versions to come.
 */
export function beginReview(run: LightRun, runId: string, answer: string): void {
  run.review = {
    versions: [version(run, runId, answer, run.launch.input.arguments)],
    shown: 0,
    pending: null,
    draining: new Set(),
    starting: 0,
    lastRunId: runId,
    closed: false,
  };
  showReview(run);
}

/**
 * The pending version is no longer waited for; its run, if it has one, stops and is no longer
 * the run the HUD follows, so asking the person something on its way out opens nothing.
 */
function dropPending(run: LightRun, review: Review): void {
  const { pending } = review;
  review.pending = null;
  if (!pending?.runId || !run.taskId) return;
  if (run.runId === pending.runId) run.runId = null;
  stopRun(run.taskId, pending.runId);
  review.draining.add(pending.runId);
}

/** Starts the pending version once the task has nothing of the review going. */
function advance(run: LightRun, review: Review): void {
  const { pending } = review;
  if (!pending || pending.started || busy(review) || !live(run)) return;
  submitVersion(run, review, pending).catch((error: unknown) => {
    console.error('The new version did not start:', error);
  });
}

/**
 * Whether the review is no longer the island's (its card closed, a newer launch replaced it, or
 * the panel took it over); its task is then let go once nothing of it is going. Every run's end
 * and every submit's answer pass here, so the hold goes exactly once, after the last of them: a
 * submit in flight holds the task again as it answers, so the hold cannot go before it.
 */
function offIsland(run: LightRun, review: Review): boolean {
  if (!run.cancelled && !run.handedOver) return false;
  if (!busy(review)) letGo(run);
  return true;
}

/**
 * A version could not start: when the card still waits for it, the card says so on the version it
 * showed; else the version that replaced it may start now.
 */
function refuse(run: LightRun, review: Review, pending: Pending): void {
  const wanted = review.pending === pending;
  if (wanted) review.pending = null;
  if (offIsland(run, review)) return;
  if (wanted) showReview(run, failed(run));
  else advance(run, review);
}

async function submitVersion(run: LightRun, review: Review, pending: Pending): Promise<void> {
  const light = lightBridge();
  const { taskId } = run;
  if (!light || !taskId) return refuse(run, review, pending);
  pending.started = true;
  review.starting += 1;
  let detail: TaskDetail;
  try {
    detail = await light.submit(
      run.launch.target.id,
      versionRequest(run.launch, taskId, pending.plan),
    );
  } catch (error) {
    console.error('The new version did not start:', error);
    review.starting -= 1;
    return refuse(run, review, pending);
  }
  review.starting -= 1;
  const started = detail.task.runs.at(-1);
  if (!started || started.id === review.lastRunId) return refuse(run, review, pending);
  trackCommandRun(run.launch, detail, true);
  review.lastRunId = started.id;
  const active = isActive(started.status);
  if (active) lightRuns.holding.set(started.id, run);
  if (run.cancelled || review.pending !== pending) {
    // The review ended, or the version was stopped or replaced while it was starting.
    if (active) {
      stopRun(taskId, started.id);
      review.draining.add(started.id);
    }
    if (!offIsland(run, review)) advance(run, review);
    return;
  }
  pending.runId = started.id;
  if (run.handedOver) {
    // It goes on in the panel; its end lets the task go.
    if (!active) review.pending = null;
    offIsland(run, review);
    return;
  }
  run.runId = started.id;
  // A run already over never reaches `followCommandRuns`, which remembers only active runs.
  if (!active)
    settleReviewRun(run, started.id, started.status, lastAnswerText(detail.blocks, started.id));
}

/**
 * Asks for a new version made as `plan` says, which the card shows as pending meanwhile. One
 * already pending is replaced: its run stops, and the new one starts once that run has ended. A
 * review with every version it keeps makes no more, and the card shows what it showed.
 */
function request(run: LightRun, review: Review, kind: PendingKind, plan: VersionPlan): void {
  if (review.versions.length >= MAX_REVIEW_VERSIONS) return showReview(run);
  dropPending(run, review);
  review.pending = { kind, plan, started: false, runId: null };
  showReview(run);
  advance(run, review);
}

/**
 * A run of the review ended (`settleLightRun`): in a review no longer the island's it may let the
 * task go (`offIsland`); a stopped one lets the next version start; the pending version's answer
 * becomes the newest version and the card shows it, or the card says the version failed and
 * stays on the one it showed.
 */
export function settleReviewRun(
  run: LightRun,
  runId: string,
  status: RunStatus,
  answer: string,
): void {
  const review = run.review;
  if (!review) return;
  const dropped = review.draining.delete(runId);
  if (offIsland(run, review)) return;
  if (dropped) return advance(run, review);
  const { pending } = review;
  if (pending?.runId !== runId) return;
  review.pending = null;
  if (status !== 'completed' || !answer) return showReview(run, failed(run));
  review.versions.push(version(run, runId, answer, pending.plan.values));
  review.shown = review.versions.length - 1;
  showReview(run);
}

/**
 * The review card went by itself (closed, copied or written), or a newer launch replaced it:
 * the pending version stops, and the task is let go once nothing of the review is going
 * (`offIsland`). Its runs still going end quietly.
 */
export function closeReview(run: LightRun): void {
  const review = run.review;
  if (!review || review.closed) return;
  review.closed = true;
  run.cancelled = true;
  dropPending(run, review);
  offIsland(run, review);
}

/**
 * The panel took the review over (Open, or a version asked the person something): a version not
 * started yet is dropped, and the task is let go once nothing of the review is still going, the
 * panel holding it from now on; a version going on ends in the panel.
 */
export function handReviewOver(run: LightRun): void {
  const review = run.review;
  if (!review) return;
  if (review.pending?.started === false) review.pending = null;
  offIsland(run, review);
}

/**
 * A press on the review card: `version` shows a kept version; `regenerate` runs the command again
 * with the shown version's values; `adjust` makes the version the card staged (`adjustPlan`);
 * `stop` stops the pending version and shows the card without it; `close` ends the review.
 */
export function actOnReview(run: LightRun, action: CommandProgressAction): void {
  const review = run.review;
  const base = review?.versions[review.shown];
  if (!review || !base || review.closed) return;
  switch (action.action) {
    case 'version': {
      const index = (action.version ?? 0) - 1;
      if (index < 0 || index >= review.versions.length) return;
      review.shown = index;
      return showReview(run);
    }
    case 'regenerate':
      return request(run, review, 'regenerate', { kind: 'command', values: base.values });
    case 'adjust': {
      if (!action.adjust) return;
      const latest = base.runId === review.lastRunId;
      const next = adjustPlan(run.launch.command, base, latest, action.adjust);
      if (!next) return showReview(run);
      return request(run, review, next.kind, next.plan);
    }
    case 'stop':
      dropPending(run, review);
      return showReview(run);
    case 'close':
      return closeReview(run);
    // Not the review card's: Open is the run's own (`actOnProgress`), the rest other cards'.
    case 'open':
    case 'cancel':
    case 'change':
    case 'run':
    case 'edit':
    case 'pick':
      return;
  }
}
