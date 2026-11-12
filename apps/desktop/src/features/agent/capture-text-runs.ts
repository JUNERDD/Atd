import type { LightCommandBridge, PreparedCommand, TaskDetail } from '../../client/agent/bridge';
import type { RunStatus } from '../../client/agent/task-schema';
import { errorMessage } from '../../client/agent/validation';
import type {
  CaptureTextBridge,
  CaptureTextProgress,
  CaptureTextRun,
} from '../../client/capture-bridge';
import {
  attachReviewSurface,
  followCaptureTextRuns,
  going,
  handOver,
  newTextRun,
  preparing,
  readBy,
  runs,
  stoppedText,
  type Preparing,
  type TextRun,
} from './capture-text-run';
import { captureDraft, captureProgress, finalState, usableAnswer } from './capture-text-progress';
import { capturePresses } from './capture-text-presses';
import { followAnswer } from './light-answer';
import { progressText, type LightHost } from './light-command';
import { stopRun } from './light-command-run';
import { reviewCard, shownCard } from './review-card';
import * as versions from './review-versions';
import { streamThrottle } from './stream-throttle';

/**
 * Runs the commands the capture editor and a long screenshot's full-screen preview run on picked
 * text (`CaptureTextBridge`), each as a new task held apart from the panel's view while it runs
 * (`light.submit`), and answers the surface's result card as it goes (`captureText.progress`):
 * `thinking` at once, `streaming` with the answer so far (paced by `streamThrottle`), its pieces
 * parsed for an output that lands on the screenshot (`captureProgress`), then its end. An
 * answer that shows something, whole or what a stop kept, becomes the run's first version
 * (`review-versions.ts`) whatever its output, and the task stays held for the versions to come
 * until the card closes or the panel takes the run over: the card steps between them, regenerates
 * and adjusts them, and the person may run the command again on the same text (`again`); a retry
 * after the person picked other text reads that text (`capture-text-presses.ts`). A run without
 * such an answer ends `stopped` or `failed` (with why). An answer that awaits applying
 * (`TextRun.awaitsApply`) shows as its first version being made from the start; any other streams
 * as it comes, and so does every version made after the first, as the card's newest page (its
 * `draft`). Stop stops the run (or the version being made), keeping what it produced; Open shows
 * the run's task in the panel, as does a run that asks the person something, and the card then
 * stops nothing; Close lets the run go, stopping what still runs unless the panel took it over.
 * `host` is read when the panel is needed. Returns the unsubscribe.
 */
export function listenCaptureTextRuns(
  bridge: CaptureTextBridge,
  light: LightCommandBridge,
  host: () => LightHost,
): () => void {
  const key = (run: Pick<TextRun, 'id'>) => `captureText-${run.id}`;

  function deliver(progress: CaptureTextProgress) {
    bridge
      .progress(progress)
      .catch((error: unknown) => console.error('The result card did not take the run:', error));
  }

  /**
   * An update of the run's own first run. Once its versions began, their updates replace these;
   * the card of an answer that awaits applying shows from the first update, as its first version
   * being made, and leaves its last (failed or stopped) without one.
   */
  function send(run: TextRun, state: CaptureTextProgress['state'], text: string) {
    if (run.answered || run.closed || run.review) return;
    const making = state === 'thinking' || state === 'streaming';
    run.answered = !making;
    const { command, input } = run.launch;
    const card = run.awaitsApply && making ? reviewCard(command, input.arguments, 1, 1) : undefined;
    deliver(captureProgress(run, state, text, state === 'done', card));
  }

  /** Lets the run's task go; a run whose card went, or the panel took over, is forgotten with it. */
  function letGo(run: TextRun) {
    light.release(key(run));
    if (run.closed || run.handedOver) runs.delete(run.id);
  }

  /** The run of the version being made, once its answer began; null otherwise. */
  function drafting(run: TextRun, review: versions.Review) {
    const { version } = run;
    const runId = review.pending?.runId;
    return runId && version?.runId === runId && version.text ? version : null;
  }

  /**
   * How the newest attempt at a version stands, which the card's update says: `failed` once when
   * it made none, `thinking` or `streaming` (its answer began) while one is made, else `done`.
   */
  function attempt(run: TextRun, review: versions.Review, failed: boolean) {
    if (failed) return 'failed';
    if (!review.pending) return 'done';
    return drafting(run, review) ? 'streaming' : 'thinking';
  }

  /**
   * The result card as the surface of a run's versions: every update is the version it is on,
   * whole and parsed as final, which the shell puts on the image (or previews, or shows on the
   * card), however the newest attempt stands (`attempt`), with the answer of a version being made
   * so far as its `draft`, once it began.
   */
  const reviews: versions.ReviewHost<TextRun> = {
    live: (run) => !run.closed && !run.cancelled && !run.handedOver && run.review?.closed === false,
    show(run, review, failed) {
      const card = shownCard(run.launch.command, review);
      const shown = review.versions[review.shown];
      if (!card || !shown) return;
      const state = attempt(run, review, failed);
      const progress = captureProgress(readBy(run, shown.runId), state, shown.answer, true, card);
      const draft = drafting(run, review);
      deliver(
        draft
          ? { ...progress, draft: captureDraft(readBy(run, draft.runId), draft.text) }
          : progress,
      );
    },
    going: (runId) => going.has(runId),
    letGo,
    // Every version keeps the run's answer format: a command run reads the text again, and a
    // follow-up is told the format for the text it read before (`SubmitTaskRequest.screenshotText`),
    // or carries the text itself when the run took other text since its task last read it.
    async submit(run, request) {
      const { selection, files } = run.launch.input;
      const carries = request.commandId === null && selection !== run.sent;
      const input = carries ? { ...request.input, selection, files } : request.input;
      const detail = await light.submit(key(run), {
        ...request,
        input,
        output: run.launch.output,
        screenshotText: run.screenshotText,
      });
      run.sent = selection;
      return detail;
    },
    started(run, detail, runId, active) {
      run.version?.stream.cancel();
      const version = { runId, text: '', stream: streamThrottle() };
      run.version = version;
      run.readings.set(runId, run.paragraphs);
      if (!active) return;
      going.add(runId);
      followAnswer(detail, {
        text: (text) => {
          version.text = text;
          version.stream.push(() => {
            const { review } = run;
            if (review?.pending?.runId === runId && reviews.live(run))
              reviews.show(run, review, false);
          });
        },
        end: (status, answer) => {
          going.delete(runId);
          version.stream.cancel();
          // What a version kept, whole or stopped, becomes one once it shows something, as the
          // run's own first answer does; else it fails, and the card stays on the one it showed.
          const kept = finalState(status) !== 'failed' && usableAnswer(readBy(run, runId), answer);
          versions.settleReviewRun(reviews, run, runId, kept ? 'completed' : 'failed', answer);
        },
      });
    },
    follow: () => undefined,
  };
  const detach = attachReviewSurface(reviews);

  /**
   * The last update of a run that did not begin versions (the panel took it over, or it has no
   * answer that shows something): its answer, or what a stop kept; otherwise `failed` with why:
   * the run's error, its answer that shows nothing, or that it had none.
   */
  function finish(run: TextRun, status: RunStatus, answer: string, error: string) {
    const state = finalState(status);
    const { name } = run.launch.command;
    if (state === 'stopped') return send(run, 'stopped', stoppedText(run, answer));
    if (state === 'done' && usableAnswer(run, answer)) return send(run, 'done', answer);
    const reason =
      state === 'done'
        ? answer || progressText('empty', name)
        : error || progressText('failed', name);
    send(run, 'failed', reason);
  }

  /**
   * The run's own first run ended: an answer that shows something, whole or what a stop kept,
   * becomes its first version, whatever its output; else the run ends on the card.
   */
  function ended(run: TextRun, runId: string, status: RunStatus, answer: string, error: string) {
    going.delete(runId);
    const kept = finalState(status) !== 'failed' && usableAnswer(run, answer);
    if (kept && !run.closed && !run.handedOver)
      return versions.beginReview(reviews, run, runId, answer);
    letGo(run);
    finish(run, status, answer, error);
  }

  function started(run: TextRun, detail: TaskDetail) {
    run.taskId = detail.task.id;
    const first = detail.task.runs.at(-1);
    run.runId = first?.id ?? null;
    if (!first) return ended(run, '', 'failed', '', '');
    run.readings.set(first.id, run.paragraphs);
    going.add(first.id);
    if (run.closed || run.stopped) stopRun(run.taskId, first.id);
    if (run.handedOver) handOver(run, host());
    followCaptureTextRuns({ type: 'task', state: detail }, host());
    followAnswer(detail, {
      text: (text) => {
        run.text = text;
        run.stream.push(() => send(run, 'streaming', run.text));
      },
      end: (status, answer, error) => {
        run.stream.cancel();
        ended(run, first.id, status, answer, error);
      },
    });
  }

  async function start(event: CaptureTextRun) {
    if (runs.has(event.runId) || preparing.has(event.runId)) return;
    const early: Preparing = { stopped: false, closed: false };
    preparing.set(event.runId, early);
    let prepared: PreparedCommand;
    try {
      prepared = await bridge.prepare(event);
    } catch (error) {
      console.error('The command on the screenshot text could not be prepared:', error);
      preparing.delete(event.runId);
      // The command is gone or cannot take the text, so it has no output of its own to name:
      // the card, where the run's failure shows, stands in for it, and nothing awaits applying.
      const output = event.arguments?.output ?? 'card';
      const source = { ...event, id: event.runId, output, awaitsApply: false };
      if (!early.closed) deliver(captureProgress(source, 'failed', errorMessage(error), false));
      return;
    }
    preparing.delete(event.runId);
    const run = newTextRun(event, prepared, early);
    if (run.closed) return;
    runs.set(run.id, run);
    if (run.stopped) return send(run, 'stopped', stoppedText(run, ''));
    send(run, 'thinking', '');
    let detail: TaskDetail;
    try {
      detail = await light.submit(key(run), {
        invocationId: crypto.randomUUID(),
        policy: null,
        taskId: null,
        commandId: run.launch.command.id,
        commandRevision: run.launch.command.revision,
        savedRun: null,
        input: run.launch.input,
        output: run.launch.output,
        screenshotText: run.screenshotText,
      });
    } catch (error) {
      console.error('The command on the screenshot text could not start:', error);
      letGo(run);
      send(run, 'failed', errorMessage(error));
      return;
    }
    started(run, detail);
  }

  const act = capturePresses({ bridge, reviews, host, letGo });
  const offRun = bridge.onRun((event) => void start(event));
  const offAction = bridge.onAction(act);
  return () => {
    offRun();
    offAction();
    detach();
  };
}
