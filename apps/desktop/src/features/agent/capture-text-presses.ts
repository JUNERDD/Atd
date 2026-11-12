import type { PreparedCommand } from '../../client/agent/bridge';
import type { CaptureTextAction, CaptureTextBridge } from '../../client/capture-bridge';
import { usableAnswer } from './capture-text-progress';
import {
  going,
  handOver,
  preparing,
  readBy,
  rescope,
  runs,
  type Reading,
  type TextRun,
} from './capture-text-run';
import type { LightHost } from './light-command';
import { stopRun } from './light-command-run';
import { adjustPlan } from './light-review-request';
import * as versions from './review-versions';

/** What the presses on a result card act through (`listenCaptureTextRuns`). */
export interface PressDeps {
  bridge: CaptureTextBridge;
  /** The result card as the surface of the runs' versions. */
  reviews: versions.ReviewHost<TextRun>;
  /** Read when the panel is needed. */
  host: () => LightHost;
  /** Lets a run's task go; a run whose card went is forgotten with it. */
  letGo: (run: TextRun) => void;
}

/**
 * How the page answers the presses on the result card of a run on screenshot text
 * (`captureText.action`), returned as the listener: before the run's command is prepared, Stop and
 * Close are kept for it (`preparing`); a run without versions stops or closes; Open hands it to
 * the panel; once it has versions, they go to its review (`review-versions.ts`), except a Stop
 * that keeps what the version being made showed (`stopVersion`), and a retry after the person
 * picked other text first reads that text (`reread`).
 */
export function capturePresses({ bridge, reviews, host, letGo }: PressDeps) {
  /** The first run of a run without versions is still going. */
  const runGoing = (run: TextRun) => run.runId !== null && going.has(run.runId);

  /**
   * Stop on a run without versions: its first run stops, and its end says how it ended, beginning
   * its versions from what it kept when that shows something (`ended`).
   */
  function stop(run: TextRun) {
    if (run.stopped) return;
    run.stopped = true;
    if (run.taskId && run.runId && runGoing(run)) stopRun(run.taskId, run.runId);
  }

  /**
   * Stop while the version being made streams an answer that already shows something: its run
   * stops and its end makes what it kept the newest version, as a stop keeps the first run's
   * answer. False when it showed nothing yet: the review drops it, and the card shows the version
   * it showed.
   */
  function stopVersion(run: TextRun): boolean {
    const { taskId, version } = run;
    const runId = run.review?.pending?.runId;
    if (!taskId || !runId || version?.runId !== runId || !going.has(runId)) return false;
    if (!usableAnswer(readBy(run, runId), version.text)) return false;
    stopRun(taskId, runId);
    return true;
  }

  /** Nothing shows the run any more: what still runs stops, and its end lets the task go. */
  function close(run: TextRun) {
    run.closed = true;
    if (!runGoing(run)) return letGo(run);
    if (run.taskId && run.runId) stopRun(run.taskId, run.runId);
  }

  /**
   * The person ran the run's command again on the same text, its options menu picking `picked`:
   * as the card's own presses, a version with the values that differ from the shown version's
   * (an adjustment of nothing but options, `adjustPlan`), else the shown version made again.
   */
  function again(run: TextRun, picked: CaptureTextAction['arguments']) {
    const review = run.review;
    const base = review?.versions[review.shown];
    if (!review || !base) return;
    const adjust = { text: '', adjustments: [], ...(picked ? { arguments: picked } : {}) };
    const latest = base.runId === review.lastRunId;
    const changes = adjustPlan(run.launch.command, base, latest, adjust) !== null;
    const press = changes ? { action: 'adjust', adjust } : { action: 'regenerate' };
    versions.actOnReview(reviews, run, press);
  }

  /**
   * A retry after the person picked other text (`reading`): the command is prepared again on that
   * text, as the run's was, and the run reads it from this version on (`rescope`); then the press
   * makes its version. Where the command can no longer take the text, the card says the retry
   * made no version and stays on the one it showed.
   */
  async function reread(run: TextRun, reading: Reading, press: versions.ReviewPress) {
    const { id: runId, surface, launch } = run;
    let prepared: PreparedCommand;
    try {
      prepared = await bridge.prepare({ runId, surface, commandId: launch.command.id, ...reading });
    } catch (error) {
      console.error('The command could not read the new text:', error);
      if (run.review && reviews.live(run)) reviews.show(run, run.review, true);
      return;
    }
    if (!reviews.live(run)) return;
    rescope(run, reading, prepared.input);
    versions.actOnReview(reviews, run, press);
  }

  /** A press on a run's card: a retry that reads other text first prepares it (`reread`). */
  function press(run: TextRun, event: CaptureTextAction): Promise<void> | null {
    const { action, adjust, reading } = event;
    const retries = action === 'regenerate' || action === 'adjust';
    if (reading && retries && reviews.live(run)) return reread(run, reading, { action, adjust });
    respond(run, event);
    return null;
  }

  /**
   * The presses on a run's card, in the order the card made them: while a retry that reads other
   * text is prepared, the presses after it wait for it.
   */
  function act(event: CaptureTextAction) {
    const early = preparing.get(event.runId);
    if (early) {
      early.stopped ||= event.action === 'stop';
      early.closed ||= event.action === 'close';
      return;
    }
    const run = runs.get(event.runId);
    if (!run) return;
    const waiting = run.rereading;
    const pressed = waiting ? waiting.then(() => press(run, event)) : press(run, event);
    if (!pressed) return;
    const queued = pressed.catch((error: unknown) => console.error('The press failed:', error));
    run.rereading = queued;
    void queued.then(() => {
      if (run.rereading === queued) run.rereading = null;
    });
  }

  /** A press that reads nothing anew, on the run as it stands. */
  function respond(
    run: TextRun,
    { action, adjust, version, arguments: picked }: CaptureTextAction,
  ) {
    if (run.closed) return;
    if (action === 'open') return handOver(run, host());
    // The panel runs it now: the card may go, but stops nothing the panel shows.
    if (run.handedOver) {
      run.closed ||= action === 'close';
      return;
    }
    if (run.review) {
      if (action === 'close') run.closed = true;
      if (action === 'again') return again(run, picked);
      if (action === 'stop' && stopVersion(run)) return;
      return versions.actOnReview(reviews, run, { action, adjust, version });
    }
    if (action === 'stop') return stop(run);
    if (action === 'close') close(run);
  }

  return act;
}
