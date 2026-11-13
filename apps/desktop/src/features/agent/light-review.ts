import type { CommandProgressAction } from '../../client/agent/bridge';
import type { RunStatus } from '../../client/agent/task-schema';
import i18n from '../../i18n';
import { trackCommandRun } from './command-results';
import { followIsland, isCurrentIsland } from './island-owner';
import { letGo, lightBridge, lightRuns, showHud, type LightRun } from './light-command-run';
import { reviewChanges, type ReviewChange } from './light-review-changes';
import { pendingCard, shownCard } from './review-card';
import * as versions from './review-versions';

/**
 * The review of a light run whose answer waits for it (`output.review`, write-backs only), shown
 * on the island's review card: the review core (`review-versions.ts`) with the island as the
 * surface its card shows on. Each version is a run in the launch's task, held under the launch's
 * write target while the card shows, whose end the light runs report (`settleLightRun`).
 */

/** The text the run read in place of the selection, which the card shows as the original. */
function source(run: LightRun): string | undefined {
  const { selection } = run.launch.input;
  return selection.trim() ? selection : undefined;
}

/** Each version's answer marked against the source (`reviewChanges`), worked out once. */
const marked = new WeakMap<versions.ReviewVersion, ReviewChange[] | null>();

function changes(run: LightRun, version: versions.ReviewVersion): ReviewChange[] | undefined {
  if (!marked.has(version)) marked.set(version, reviewChanges(source(run), version.answer) ?? null);
  return marked.get(version) ?? undefined;
}

/**
 * The island as the surface of a light run's review. The card (`commandProgress.show`'s `answer`
 * with `review`) shows the page it is on: a kept version, with the source and the answer's
 * changes, which version of how many, the command's options with that version's values, its
 * adjustments, and what is pending; or the pending version's page after them, with the source and
 * what came of its answer so far (`pendingCard`). A failed attempt adds a note saying so. It is
 * the page's while the run's HUD is the island on screen and neither the person nor a newer
 * launch ended the review.
 */
const island: versions.ReviewHost<LightRun> = {
  live: (run) =>
    isCurrentIsland(run) && !run.cancelled && !run.handedOver && run.review?.closed === false,
  show(run, review, failed) {
    const { command } = run.launch;
    const shown = review.versions[review.shown];
    const making = review.showsPending ? review.pending : null;
    const card = making ? pendingCard(command, review) : shownCard(command, review);
    if (!shown || !card) return;
    const original = source(run);
    const answerChanges = making ? undefined : changes(run, shown);
    showHud(run, {
      phase: 'answer',
      command: command.name,
      answer: making ? making.text : shown.answer,
      ...(failed
        ? { note: i18n.t('tasks:commandOutput.review.failed', { command: command.name }) }
        : {}),
      review: {
        ...(original ? { source: original } : {}),
        ...(answerChanges ? { changes: answerChanges } : {}),
        ...card,
      },
    });
  },
  going: (runId) => lightRuns.holding.has(runId),
  letGo,
  submit(run, request) {
    const light = lightBridge();
    if (!light) return Promise.reject(new Error('The progress HUD is not available.'));
    return light.submit(run.launch.target.id, request);
  },
  started(run, detail, runId, active, text) {
    trackCommandRun(run.launch, detail, true, text);
    if (active) lightRuns.holding.set(runId, run);
  },
  follow: (_run, detail) => followIsland({ type: 'task', state: detail }),
};

/**
 * Starts the review of a light run whose first answer came (its own run, `runId`): the card shows
 * the answer as the first version, and the task stays held for the versions to come.
 */
export function beginReview(run: LightRun, runId: string, answer: string): void {
  versions.beginReview(island, run, runId, answer);
}

/** A run of the review ended (`settleLightRun`); see `versions.settleReviewRun`. */
export function settleReviewRun(
  run: LightRun,
  runId: string,
  status: RunStatus,
  answer: string,
): void {
  versions.settleReviewRun(island, run, runId, status, answer);
}

/** The review card went by itself, or a newer launch replaced it (`versions.closeReview`). */
export function closeReview(run: LightRun): void {
  versions.closeReview(island, run);
}

/** The panel took the review over (`versions.handReviewOver`). */
export function handReviewOver(run: LightRun): void {
  versions.handReviewOver(island, run);
}

/**
 * A press on the review card (`versions.actOnReview`); Open is the run's own (`actOnProgress`),
 * and the other cards' presses are not the review's.
 */
export function actOnReview(run: LightRun, action: CommandProgressAction): void {
  versions.actOnReview(island, run, action);
}
