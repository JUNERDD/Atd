import type {
  AgentEvent,
  CommandProgressAction,
  LightCommandBridge,
  PreparedCommand,
  TaskDetail,
} from '../../client/agent/bridge';
import { valuesSummary } from '../../client/agent/command-arguments';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import { showErrorToast, showToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { refusalText, unwrittenText, writeInto } from './command-answer';
import { runWaits } from './light-answer';
import { actOnIsland, followIsland, isCurrentIsland, replaceIsland } from './island-owner';
import { chooseLightRun } from './light-command-choose';
import { trackCommandRun, type SettledCommandRun } from './command-results';
import {
  hideHud,
  letGo,
  lightBridge,
  lightRuns,
  showHud,
  stopRun,
  type LightLaunch,
  type LightRun,
} from './light-command-run';
import {
  actOnReview,
  beginReview,
  closeReview,
  handReviewOver,
  settleReviewRun,
} from './light-review';
import { lastAnswerText } from './transcript/final-answer';
import { agentApi } from './use-agent';

/** What a light run asks of the panel when it needs it after all. */
export interface LightHost {
  /** Shows the task, as choosing it from the history does. */
  openTask: (taskId: string) => void;
  /** Shows the command's input step, where a run that could not start is reviewed. */
  showInput: (prepared: PreparedCommand) => void;
  /** Reveals the panel with what it now shows. */
  reveal: () => void;
  /**
   * Runs a launch in the panel, as a launch that runs as-is does: one whose options the card
   * changed so that it no longer runs light (its answer now goes to the conversation, say).
   */
  run: (prepared: PreparedCommand) => void;
}

const { holding } = lightRuns;

function notice(run: LightRun, message: string) {
  if (isCurrentIsland(run)) showHud(run, { phase: 'notice', message });
  // A run whose HUD a newer launch replaced reports where a background run would.
  else showToast({ kind: 'warning', text: message });
}

/**
 * Shows `answer`, which could not be written, on the run's answer card, with why (`note`; none
 * when the field could never take it). A run whose HUD a newer launch replaced puts it on the
 * clipboard instead, where a background run's would go.
 */
function offer(run: LightRun, answer: string, note?: string) {
  if (isCurrentIsland(run)) {
    const { name } = run.launch.command;
    showHud(run, { phase: 'answer', command: name, answer, ...(note ? { note } : {}) });
    return;
  }
  agentApi()
    .copy(answer)
    .then(() => showToast({ kind: 'info', text: i18n.t('tasks:commandOutput.copied') }))
    .catch((error: unknown) => console.error('The unwritten answer was not copied:', error));
}

function text(key: 'failed' | 'stopped' | 'startFailed' | 'empty', run: LightRun): string {
  return i18n.t(`tasks:commandOutput.progress.${key}`, { command: run.launch.command.name });
}

/**
 * Starts a light launch: its HUD shows at once, replacing any other, and the run starts on a
 * task held apart from the panel's view, so the panel keeps showing what it showed. The run it
 * replaces is cancelled while it is still going: finishing unseen, it would pull the focus back
 * to its field and write there while the person works elsewhere. A run that cannot start leaves a
 * notice whose Open shows the command's input step.
 */
export async function startLightRun(launch: LightLaunch, light: LightCommandBridge): Promise<void> {
  const run: LightRun = {
    launch,
    taskId: null,
    runId: null,
    error: null,
    cancelled: false,
    handedOver: false,
    review: null,
  };
  replaceIsland({
    key: launch.target.id,
    holdKey: launch.target.id,
    identity: run,
    act: (action, host) => actOnRun(run, action, host),
    supersede: () => supersede(run),
    follow: (event, host) => followLightRun(run, event, host),
  });
  const summary = valuesSummary(launch.command, launch.input.arguments);
  showHud(run, { phase: 'working', command: launch.command.name, ...(summary ? { summary } : {}) });
  let detail: TaskDetail;
  try {
    detail = await light.submit(launch.target.id, {
      invocationId: crypto.randomUUID(),
      policy: null,
      taskId: null,
      commandId: launch.command.id,
      commandRevision: launch.command.revision,
      savedRun: null,
      input: launch.input,
      output: launch.output,
      ...(launch.shortcutId === undefined ? {} : { shortcutId: launch.shortcutId }),
    });
  } catch (error) {
    letGo(run);
    run.error = error;
    if (!run.cancelled) notice(run, text('startFailed', run));
    return;
  }
  trackCommandRun(launch, detail, true);
  const started = detail.task.runs.at(-1);
  run.taskId = detail.task.id;
  run.runId = started?.id ?? null;
  if (!started) return letGo(run);
  // A run already over never reaches `followCommandRuns`, which remembers only active runs.
  if (!isActive(started.status)) {
    if (run.cancelled) return letGo(run);
    const answer = started.status === 'completed' ? lastAnswerText(detail.blocks, started.id) : '';
    return end(run, started.id, started.status, answer);
  }
  holding.set(started.id, run);
  if (run.cancelled) stop(run);
  followIsland({ type: 'task', state: detail });
}

/** Whether a light run is still going: it has not ended (its hold is there) or failed to start. */
function going(run: LightRun): boolean {
  return run.runId ? holding.has(run.runId) : run.error === null;
}

/**
 * Cancels a light run a newer launch replaces, unless the panel took it over or it already ended
 * (its hold is gone, or it never started). One still submitting stops as soon as it starts. A
 * review ends as its card closing ends it, letting its task go.
 */
function supersede(run: LightRun) {
  if (run.handedOver) return;
  if (run.review) return closeReview(run);
  if (run.cancelled || !going(run)) return;
  run.cancelled = true;
  stop(run);
}

function stop(run: LightRun) {
  if (run.taskId && run.runId) stopRun(run.taskId, run.runId);
}

/**
 * Takes a light run's end from `followCommandRuns` and says whether it handled it: that run's hold
 * goes, and while its HUD shows, the answer is written (the HUD goes as the write starts), shown
 * on the answer card where it cannot be written, offered for review, or a notice says why the run
 * gave none. A run of a review, whatever became of the review, is the review's to settle
 * (`settleReviewRun`), which lets its task go once. A run the person cancelled, or a newer launch
 * replaced, ends quietly. A run the panel took over is left to act as any other run.
 */
export function settleLightRun({ run: record, status, answer }: SettledCommandRun): boolean {
  const run = holding.get(record.runId);
  if (!run) return false;
  holding.delete(record.runId);
  if (run.review) {
    settleReviewRun(run, record.runId, status, answer);
    return !run.handedOver;
  }
  if (run.cancelled) {
    letGo(run);
    return true;
  }
  if (run.handedOver) {
    letGo(run);
    return false;
  }
  end(run, record.runId, status, answer);
  return true;
}

function end(run: LightRun, runId: string, status: RunStatus, answer: string) {
  endLightRun(run, runId, status, answer).catch((error: unknown) => {
    console.error('The light command run did not finish:', error);
  });
}

/**
 * The end of a light launch's own run. An answer under review starts the review while the run's
 * HUD shows, keeping the task held for the versions to come; anything else lets the task go. An
 * answer meant for a card shows on the answer card, where the shell offers Copy, Insert and Open.
 */
async function endLightRun(
  run: LightRun,
  runId: string,
  status: RunStatus,
  answer: string,
): Promise<void> {
  const { target, output } = run.launch;
  const reviewed =
    status === 'completed' && answer !== '' && output.action !== 'card' && output.review;
  if (reviewed && isCurrentIsland(run)) return beginReview(run, runId, answer);
  letGo(run);
  // Never written by itself: one whose HUD a newer launch replaced goes on the clipboard.
  if (reviewed) return offer(run, answer);
  if (status !== 'completed')
    return notice(
      run,
      text(status === 'stopped' || status === 'cancelled' ? 'stopped' : 'failed', run),
    );
  if (!answer) return notice(run, text('empty', run));
  if (
    output.action === 'card' ||
    !target.writable ||
    (target.selectionKind !== undefined &&
      target.selectionKind !== 'text' &&
      output.action === 'insertAfterSelection')
  )
    return offer(run, answer);
  await hideHud(run);
  const reason = await writeInto(runId, target, output.action, answer);
  if (!reason) return;
  if (reason !== 'interrupted') return offer(run, answer, unwrittenText(reason, target.app));
  // Only the beginning went in, while the person was working there: the whole answer goes on
  // the clipboard rather than a card over what they are doing.
  await agentApi().copy(answer);
  notice(run, refusalText(reason, target.app));
}

/** The panel takes the run over and shows it; the HUD goes. */
function handOver(run: LightRun, host: LightHost) {
  run.handedOver = true;
  void hideHud(run);
  handReviewOver(run);
  if (run.taskId) host.openTask(run.taskId);
  else {
    host.showInput(run.launch);
    if (run.error) showErrorToast(run.error);
  }
  host.reveal();
}

/**
 * A press on the HUD of a light run: Open (on a notice, the answer card or the review card) shows
 * it in the panel; cancel stops the working run; the review card's actions are its review's
 * (`actOnReview`). Changing the working run's values stops it and offers its options again.
 */
export const actOnProgress = actOnIsland;

function actOnRun(run: LightRun, action: CommandProgressAction, host: LightHost): void {
  if (run.handedOver || run.review?.closed) return;
  if (action.action === 'change') {
    const light = lightBridge();
    const launch = changeLightRun(run);
    if (launch && light) chooseLightRun(launch, light);
    return;
  }
  if (action.action === 'open') return handOver(run, host);
  if (run.review) return actOnReview(run, action);
  if (action.action !== 'cancel') return;
  run.cancelled = true;
  stop(run);
}

/**
 * The person asked to change the values of the light run `target` shows while it works (its
 * values chip): the run stops, quietly, as a cancelled one does, and its launch is returned to be
 * offered again. Nothing was written yet, since the HUD goes as the write starts. Null when no
 * such run is still going there, or the run is under review (its card changes values itself).
 */
function changeLightRun(run: LightRun): LightLaunch | null {
  if (run.review || run.cancelled || !going(run)) return null;
  run.cancelled = true;
  stop(run);
  return run.launch;
}

/**
 * Follows the light run on screen: one that asks the person something (a confirmation or a
 * question), its own run or a version of its review, can only go on in the panel, which then
 * shows it.
 */
function followLightRun(run: LightRun, event: AgentEvent, host: LightHost): void {
  if (!run?.taskId || !run.runId || run.handedOver || run.cancelled) return;
  if (runWaits(event, run.taskId, run.runId) && holding.has(run.runId)) handOver(run, host);
}
