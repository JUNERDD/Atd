import type {
  AgentEvent,
  CommandProgressAction,
  CommandProgressState,
  LightCommandBridge,
  PreparedCommand,
  SubmitRequest,
  TaskDetail,
} from '../../client/agent/bridge';
import { withScreenshot, type Screenshot } from '../../client/agent/screenshot-input';
import { emptyInput, type RunStatus } from '../../client/agent/task-schema';
import { errorMessage } from '../../client/agent/validation';
import { showErrorToast, showToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { followAnswer, runWaits } from './light-answer';
import type { LightHost } from './light-command';
import { followIsland, isCurrentIsland, replaceIsland } from './island-owner';
import { lightBridge, stopRun } from './light-command-run';
import { agentApi } from './use-agent';

/** The longest note an answer card takes (`commandProgress.show`). */
const MAX_NOTE_LENGTH = 500;

/**
 * A run the screenshot toolbar started on the island, without the panel: a question about the
 * screenshot, or a command whose answer is copied. Its HUD is keyed by `key`, a key of its own.
 */
interface CaptureRun {
  key: string;
  /** The HUD's title: the command's name, or Ask Atd. */
  title: string;
  /** What Open shows when the run never started: the command's input step (a question has none). */
  prepared: PreparedCommand | null;
  /** How its answer ends the run while its HUD shows. */
  settle: (run: CaptureRun, answer: string) => Promise<void>;
  taskId: string | null;
  runId: string | null;
  error: unknown;
  /** The run ended (or never started); nothing of it runs any more. */
  ended: boolean;
  /** The person cancelled it, or a newer launch replaced it: its end shows nothing. */
  cancelled: boolean;
  /** The panel shows it (it asked for the person, or Open); its HUD went. */
  handedOver: boolean;
}

function show(run: CaptureRun, state: CommandProgressState) {
  lightBridge()
    ?.show(run.key, state)
    .catch((error: unknown) => console.error('The progress HUD did not show:', error));
}

/** A notice on the run's HUD while it shows, else where a background run's would go. */
function notice(run: CaptureRun, message: string, kind: 'info' | 'warning' = 'warning') {
  if (isCurrentIsland(run) && !run.handedOver) show(run, { phase: 'notice', message });
  else showToast({ kind, text: message });
}

function stop(run: CaptureRun) {
  if (run.taskId && run.runId && !run.ended) stopRun(run.taskId, run.runId);
}

/** The panel takes the run over and shows it, or the command's input step when it never started. */
function handOver(run: CaptureRun, host: LightHost) {
  run.handedOver = true;
  lightBridge()
    ?.hide(run.key)
    .catch((error: unknown) => console.error('The progress HUD did not hide:', error));
  if (run.taskId) host.openTask(run.taskId);
  else {
    if (run.prepared) host.showInput(run.prepared);
    if (run.error) showErrorToast(run.error);
  }
  host.reveal();
}

/** A press on the run's HUD: Open shows it in the panel; cancel stops it while it works. */
function act(run: CaptureRun, action: CommandProgressAction, host: LightHost) {
  if (run.handedOver) return;
  if (action.action === 'open') return handOver(run, host);
  if (action.action !== 'cancel') return;
  run.cancelled = true;
  stop(run);
}

/**
 * The run's end: its task goes, and unless it was cancelled, a completed run's answer settles as
 * the run says (`settle`, also once the panel took it over), and a notice says why any other run
 * gave none while its HUD still shows.
 */
function ended(run: CaptureRun, status: RunStatus, answer: string) {
  run.ended = true;
  lightBridge()?.release(run.key);
  if (run.cancelled) return;
  if (status === 'completed') {
    run.settle(run, answer).catch((error: unknown) => notice(run, errorMessage(error)));
    return;
  }
  const key = status === 'stopped' || status === 'cancelled' ? 'stopped' : 'failed';
  if (!run.handedOver)
    notice(run, i18n.t(`tasks:commandOutput.progress.${key}`, { command: run.title }));
}

/**
 * Starts `run` on the island with `request`, replacing whatever the island showed (a light run, an
 * options or compose card, another capture run): its HUD works at once, and its task is held apart
 * from the panel's view until the run ends. A light run it replaces is no longer the one on screen,
 * as with a newer light launch, so one still writing reports off the island (a toast, the
 * clipboard) rather than over this run's HUD. A run that cannot start leaves a notice whose Open
 * shows the command's input step.
 */
async function start(
  run: CaptureRun,
  request: Omit<SubmitRequest, 'action'>,
  light: LightCommandBridge,
): Promise<void> {
  replaceIsland({
    key: run.key,
    identity: run,
    act: (action, host) => act(run, action, host),
    follow: (event, host) => followCaptureRun(run, event, host),
    supersede: () => {
      if (run.handedOver || run.ended) return;
      run.cancelled = true;
      stop(run);
    },
  });
  show(run, { phase: 'working', command: run.title });
  let detail: TaskDetail;
  try {
    detail = await light.submit(run.key, request);
  } catch (error) {
    light.release(run.key);
    run.ended = true;
    run.error = error;
    if (!run.cancelled)
      notice(run, i18n.t('tasks:commandOutput.progress.startFailed', { command: run.title }));
    return;
  }
  run.taskId = detail.task.id;
  run.runId = detail.task.runs.at(-1)?.id ?? null;
  if (run.cancelled) stop(run);
  followIsland({ type: 'task', state: detail });
  followAnswer(detail, { end: (status, answer) => ended(run, status, answer) });
}

/**
 * Follows the capture run on screen: one that asks the person something (a confirmation or a
 * question) can only go on in the panel, which then shows it.
 */
function followCaptureRun(run: CaptureRun, event: AgentEvent, host: LightHost): void {
  if (!run?.taskId || !run.runId || run.ended || run.cancelled || run.handedOver) return;
  if (runWaits(event, run.taskId, run.runId)) handOver(run, host);
}

function captureRun(
  title: string,
  prepared: PreparedCommand | null,
  settle: CaptureRun['settle'],
): CaptureRun {
  return {
    key: crypto.randomUUID(),
    title,
    prepared,
    settle,
    taskId: null,
    runId: null,
    error: null,
    ended: false,
    cancelled: false,
    handedOver: false,
  };
}

/**
 * Asks `question` about the screenshot `shot` on the island: the question runs as a new task with
 * the screenshot (and its screen context) attached, and its answer shows on the island's answer
 * card, titled Ask Atd with the question under it, whose Open shows the task in the panel.
 */
export function startLightAsk(question: string, shot: Screenshot, light: LightCommandBridge) {
  const title = i18n.t('tasks:commandOutput.ask.title');
  const note = i18n.t('tasks:commandOutput.ask.note', { question }).slice(0, MAX_NOTE_LENGTH);
  // The panel shows the answer of a question it took over.
  const run = captureRun(title, null, async (asked, answer) => {
    if (asked.handedOver) return;
    if (!answer) return notice(asked, i18n.t('tasks:commandOutput.ask.empty'));
    if (isCurrentIsland(asked)) show(asked, { phase: 'answer', command: title, answer, note });
  });
  return start(
    run,
    {
      invocationId: crypto.randomUUID(),
      policy: null,
      taskId: null,
      commandId: null,
      commandRevision: null,
      savedRun: null,
      input: withScreenshot({ ...emptyInput(), text: question }, shot),
    },
    light,
  );
}

/**
 * Runs a command the screenshot toolbar launched whose answer is copied, on the island: its HUD
 * works, and its answer goes on the clipboard, which the HUD confirms. Copied too when the panel
 * took it over, where a toast confirms it.
 */
export function startLightCopy(prepared: PreparedCommand, light: LightCommandBridge) {
  const { command } = prepared;
  const run = captureRun(command.name, prepared, async (copied, answer) => {
    if (!answer)
      return notice(
        copied,
        i18n.t('tasks:commandOutput.progress.emptyCopy', { command: command.name }),
      );
    await agentApi().copy(answer);
    notice(copied, i18n.t('tasks:commandOutput.copied'), 'info');
  });
  return start(
    run,
    {
      invocationId: crypto.randomUUID(),
      policy: null,
      taskId: null,
      commandId: command.id,
      commandRevision: command.revision,
      savedRun: null,
      input: prepared.input,
      output: prepared.output,
      ...(prepared.shortcutId === undefined ? {} : { shortcutId: prepared.shortcutId }),
    },
    light,
  );
}
