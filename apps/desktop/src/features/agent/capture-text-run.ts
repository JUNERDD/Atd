import type { CaptureParagraph, CommandScreenshotText } from '@atd/agent-contracts';
import type { AgentEvent, PreparedCommand } from '../../client/agent/bridge';
import type { TaskInput } from '../../client/agent/task-schema';
import type {
  CaptureTextAction,
  CaptureTextProgress,
  CaptureTextRun,
} from '../../client/capture-bridge';
import { usableAnswer, type ProgressSource } from './capture-text-progress';
import { runWaits } from './light-answer';
import { progressText, type LightHost } from './light-command';
import type { ReviewLaunch } from './light-review-request';
import * as versions from './review-versions';
import { streamThrottle, type StreamThrottle } from './stream-throttle';

/**
 * The runs on screenshot text the page follows (`capture-text-runs.ts` speaks the card's protocol
 * for them): each run's state, the records the orchestrator and the panel's events share, and the
 * panel taking a run over.
 */

/** The text a retry reads anew (`captureText.action`'s `reading`). */
export type Reading = NonNullable<CaptureTextAction['reading']>;

/** One run on text picked in a screenshot, from its first update to the card's `close`. */
export interface TextRun extends versions.ReviewedRun {
  /** The shell's id for the run. */
  readonly id: string;
  /** The surface showing its card, which reads the text again for a retry. */
  readonly surface: CaptureTextRun['surface'];
  /**
   * What its next version reads (`rescope` changes them when a retry reads other text): the
   * command prepared on the text, the paragraphs, and how the service is told they were picked.
   */
  launch: ReviewLaunch;
  paragraphs: readonly CaptureParagraph[];
  screenshotText: CommandScreenshotText;
  /** The paragraphs each of its task's runs read, by run id, which that run's answer refers to. */
  readonly readings: Map<string, readonly CaptureParagraph[]>;
  /** The selection the task's runs last read: a follow-up carries the launch's when it differs. */
  sent: string;
  /** A retry reading other text is being prepared: the card's later presses wait for it. */
  rereading: Promise<unknown> | null;
  readonly output: CaptureTextProgress['output'];
  /**
   * The answer waits for the person to apply it before it lands: `output.review` on `annotate`,
   * whose review setting promises its marks as a preview on the screenshot. A write-back's review is
   * the island's, before the answer goes into another app; on a screenshot its replacements and
   * steps land at once, where the result card lists them, ⌥ shows the original text and Restore or
   * ⌘Z takes them off, so a second step to apply what already shows there would only be in the way.
   * Any other answer already waits on the card. Every run keeps versions once its first answer
   * came; this decides only that the answer waits (`CaptureTextProgress.awaitsApply`) and that its
   * first version shows on the card as being made.
   */
  readonly awaitsApply: boolean;
  /** The answer so far of the run's own first run. */
  text: string;
  /** Paces the card's updates while that answer grows; cancelled once the run ended. */
  readonly stream: StreamThrottle;
  /** The run making its newest version, while one is made or since the last one was. */
  version: VersionRun | null;
  /** Its last update went (`done`, `stopped` or `failed`) and no versions followed. */
  answered: boolean;
  /**
   * The person stopped its first run: it stops once that run is known, and what it kept, if it
   * shows something, becomes its first version.
   */
  stopped: boolean;
  /** The card went (`close`): what still runs stops, and the task is let go once it ended. */
  closed: boolean;
}

/**
 * The run of a version, by its run id: its answer so far (empty until it began), which the card
 * shows as its newest page while the version is made, and what paces the card's updates as it
 * grows, cancelled once that run ended.
 */
export interface VersionRun {
  readonly runId: string;
  text: string;
  readonly stream: StreamThrottle;
}

/** Early presses on a run whose command is still being prepared. */
export interface Preparing {
  stopped: boolean;
  closed: boolean;
}

/** The runs by the shell's id, until the card closes or the panel took one over and it ended. */
export const runs = new Map<string, TextRun>();
export const preparing = new Map<string, Preparing>();
/** The runs of these tasks still going, until their ends settled. */
export const going = new Set<string>();
/** The result card as the surface of the runs' versions, while the page listens. */
let surface: versions.ReviewHost<TextRun> | null = null;

/** Makes `host` the surface of the runs' versions; returns what ends that. */
export function attachReviewSurface(host: versions.ReviewHost<TextRun>): () => void {
  surface = host;
  return () => {
    if (surface === host) surface = null;
  };
}

/** A run on `event`'s text with its `prepared` command, keeping the presses made meanwhile. */
export function newTextRun(
  event: CaptureTextRun,
  prepared: PreparedCommand,
  early: Preparing,
): TextRun {
  const { command, input, output, shortcutId } = prepared;
  return {
    id: event.runId,
    surface: event.surface,
    launch: { command, input, output, ...(shortcutId === undefined ? {} : { shortcutId }) },
    paragraphs: event.paragraphs,
    screenshotText: { scope: event.scope, paragraphs: event.paragraphs.length },
    readings: new Map(),
    sent: input.selection,
    rereading: null,
    output: output.action,
    awaitsApply: output.review && output.action === 'annotate',
    taskId: null,
    runId: null,
    cancelled: false,
    handedOver: false,
    review: null,
    text: '',
    stream: streamThrottle(),
    version: null,
    answered: false,
    stopped: early.stopped,
    closed: early.closed,
  };
}

/**
 * The run reads `reading` from its next version on: the person picked other text since it last
 * read (`captureText.action`'s `reading`), on which the command was prepared again as `input`.
 * Its versions so far keep the paragraphs their runs read (`readings`), by the ids the shell kept
 * for them, so they still show as they were.
 */
export function rescope(run: TextRun, reading: Reading, input: TaskInput): void {
  run.launch = { ...run.launch, input };
  run.paragraphs = reading.paragraphs;
  run.screenshotText = { scope: reading.scope, paragraphs: reading.paragraphs.length };
}

/** The run as the card shows the answer of its task's run `runId`: on what that run read. */
export function readBy(run: TextRun, runId: string): ProgressSource {
  const { id, output, awaitsApply } = run;
  return { id, output, awaitsApply, paragraphs: run.readings.get(runId) ?? run.paragraphs };
}

/** What a stopped run leaves on the card: what it kept, when that shows something, else why. */
export function stoppedText(run: TextRun, answer: string): string {
  return usableAnswer(run, answer) ? answer : progressText('stopped', run.launch.command.name);
}

/**
 * The panel takes the run over and shows it. Its versions, if any, stop being the card's: the card
 * keeps the version it shows, no longer waiting for one, which the panel now makes.
 */
export function handOver(run: TextRun, host: LightHost): void {
  run.handedOver = true;
  if (!run.taskId) return;
  const { review } = run;
  if (review && surface) {
    versions.handReviewOver(surface, run);
    surface.show(run, { ...review, pending: null }, false);
  }
  host.openTask(run.taskId);
  host.reveal();
}

/**
 * Follows the runs on screenshot text still going: one that asks the person something (a
 * confirmation or a question), its own run or one making a version, can only go on in the panel,
 * which then shows it.
 */
export function followCaptureTextRuns(event: AgentEvent, host: LightHost): void {
  for (const run of runs.values()) {
    if (!run.taskId || !run.runId || run.handedOver || run.closed) continue;
    if (going.has(run.runId) && runWaits(event, run.taskId, run.runId)) handOver(run, host);
  }
}
