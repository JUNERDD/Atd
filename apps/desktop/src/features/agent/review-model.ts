import type { Static } from 'typebox';
import type { SubmitRequest, TaskDetail } from '../../client/agent/bridge';
import type { ArgumentValues } from '../../client/agent/command-schema';
import type { ReviewAdjustSchema } from '../../native-bridge/command-review';
import type { ReviewPendingKind as PendingKind } from './review-card';
import type { ReviewLaunch, VersionPlan } from './light-review-request';
import type { StreamThrottle } from './stream-throttle';

/**
 * What a review is, and what the surface showing its card provides: the review's state, which
 * `review-versions.ts` drives, and the card's presses it takes.
 */

/** One kept answer of a review, made by one run of its task. */
export interface ReviewVersion {
  runId: string;
  answer: string;
  /** The option values it ran with, which the card shows and its next version starts from. */
  values: ArgumentValues;
}

/** The version being made, which the card shows as pending until it comes or is stopped. */
export interface Pending {
  kind: PendingKind;
  plan: VersionPlan;
  /** Its submit was sent; `runId` names its run once the submit answered. */
  started: boolean;
  runId: string | null;
  /** Its answer so far, as it streams in ('' before any of it). */
  text: string;
}

/**
 * The review of a launch whose answer waits for it (`output.review`): its versions, each a run in
 * the launch's task, which stays held while the review card shows. The task runs one run at a
 * time, so a new version starts only once no stopped run of it is still going (`draining`) and no
 * submit is still in flight (`starting`).
 */
export interface Review {
  versions: ReviewVersion[];
  /** The index of the kept version the card shows, or showed last while on `pending`'s page. */
  shown: number;
  pending: Pending | null;
  /**
   * The card is on the pending version's page, after the kept ones: where it goes as the version
   * is asked for, and where that version shows once it comes.
   */
  showsPending: boolean;
  /** Paces the card's updates while the pending version's answer streams onto its page. */
  paced: StreamThrottle;
  /** Runs stopped or replaced while the page no longer waits for them, until they end. */
  draining: Set<string>;
  starting: number;
  /** The task's newest run: a follow-up adjusts its answer unless it quotes another. */
  lastRunId: string;
  /** The card went (`close`), or a newer launch replaced it: the task is let go. */
  closed: boolean;
}

/** A launch under review, as the surface showing its card keeps it. */
export interface ReviewedRun {
  readonly launch: ReviewLaunch;
  taskId: string | null;
  /** The run the card follows: the launch's own run, then the review's newest run. */
  runId: string | null;
  /** The card went, or a newer launch replaced it: whatever of it still runs stops, quietly. */
  cancelled: boolean;
  /** The panel shows it (it asked for the person, or Open): its runs end as any other run's. */
  handedOver: boolean;
  /** The review its first answer started; null before. */
  review: Review | null;
}

/**
 * What a review needs from the surface showing its card: the island over another app
 * (`light-review.ts`), or the result card beside a screenshot (`capture-text-runs.ts`).
 */
export interface ReviewHost<R extends ReviewedRun> {
  /** Whether the run's card is on screen and still the page's to answer. */
  live: (run: R) => boolean;
  /** Shows the version the card is on; `failed`: the latest attempt made no version. */
  show: (run: R, review: Review, failed: boolean) => void;
  /** Whether the review's run `runId` is still going: its end has not been settled yet. */
  going: (runId: string) => boolean;
  /** Lets the review's task go, once nothing of it is going. */
  letGo: (run: R) => void;
  /** Submits the run of a version in the review's task. */
  submit: (run: R, request: Omit<SubmitRequest, 'action'>) => Promise<TaskDetail>;
  /**
   * A version's run `runId` started, still going when `active`: the host follows it to its end,
   * which it settles with `settleReviewRun` (a run already over is settled by the review itself),
   * and tells `text` its answer as it grows, for the card's page of it.
   */
  started: (
    run: R,
    detail: TaskDetail,
    runId: string,
    active: boolean,
    text: (text: string) => void,
  ) => void;
  /** The run of the version the card waits for started, which the host now follows as the card's. */
  follow: (run: R, detail: TaskDetail) => void;
}

/** What the card presses ask of the review: the shared actions of every review card. */
export interface ReviewPress {
  action: string;
  version?: number | undefined;
  adjust?: Static<typeof ReviewAdjustSchema> | undefined;
}
