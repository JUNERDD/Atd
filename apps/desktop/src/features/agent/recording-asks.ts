import type { AgentEvent, LightCommandBridge, TaskDetail } from '../../client/agent/bridge';
import { emptyInput, type RunStatus } from '../../client/agent/task-schema';
import type {
  RecordingAnswer,
  RecordingAsk,
  RecordingAsksBridge,
} from '../../client/capture-bridge';
import { MAX_NATIVE_TEXT_LENGTH } from '../../native-bridge/primitives';
import { followAnswer, runWaits } from './light-answer';
import type { LightHost } from './light-command';
import { stopRun } from './light-command-run';

/** How often a growing answer goes to the result card at most. */
const STREAM_INTERVAL_MS = 120;

/** Whose result card asked: a screen recording's or a long screenshot's. */
type AskSource = RecordingAsk['source'];

/** One question about a recording or a long screenshot, from its ask to its last answer update. */
interface AskRun {
  askId: string;
  source: AskSource;
  /** The recording or long screenshot it is about. */
  sourceId: string;
  taskId: string | null;
  runId: string | null;
  /** The answer so far. */
  text: string;
  /** A growing answer went to the card less than `STREAM_INTERVAL_MS` ago. */
  throttled: boolean;
  /** Its last update went to the card (`done`, `stopped` or `failed`); nothing follows it. */
  answered: boolean;
  /** The person stopped it before its run was known: it stops once it is. */
  stopped: boolean;
  /** Open asked for it before its task was known: the panel shows it once it is. */
  opened: boolean;
  /** The panel already showed it because it waited for the person. */
  handedOver: boolean;
}

const asks = new Map<string, AskRun>();
/**
 * The recording and the long screenshot whose cards own answer pages now, one of each: all their
 * pages remain openable after their asks ended (`endedTasks`), and a new recording or long
 * screenshot drops only the ended asks of its own source.
 */
const owners = new Map<AskSource, string>();
const endedTasks = new Map<string, { source: AskSource; taskId: string }>();

function key(run: Pick<AskRun, 'askId' | 'source'>): string {
  return `${run.source}-${run.askId}`;
}

function finalState(status: RunStatus): RecordingAnswer['state'] {
  if (status === 'completed') return 'done';
  return status === 'stopped' || status === 'cancelled' ? 'stopped' : 'failed';
}

/**
 * Runs the questions a recording's or a long screenshot's result card asks
 * (`RecordingAsksBridge`) as tasks the panel does not show, with the card's source as their input
 * source, each held apart from the panel's view (`light.submit`) until its run ends, and answers
 * the card as each answer grows: `thinking` at once, `streaming` with the text so far (at most
 * every `STREAM_INTERVAL_MS`), then `done`, `stopped` or `failed` with what it produced. Stop stops
 * the run and answers `stopped` at once, keeping that text; Open shows the ask's task in the panel,
 * also after it ended. `host` is read when the panel is needed. Returns the unsubscribe.
 */
export function listenRecordingAsks(
  bridge: RecordingAsksBridge,
  light: LightCommandBridge,
  host: () => LightHost,
): () => void {
  function send(run: AskRun, state: RecordingAnswer['state'], text: string) {
    if (run.answered) return;
    run.answered = state === 'done' || state === 'stopped' || state === 'failed';
    bridge
      .answer({
        askId: run.askId,
        source: run.source,
        state,
        text: text.slice(0, MAX_NATIVE_TEXT_LENGTH),
      })
      .catch((error: unknown) => console.error('The answer did not reach the result card:', error));
  }

  /** The answer grew: the card hears it now, or once the interval since the last update passed. */
  function grow(run: AskRun, text: string) {
    run.text = text;
    if (run.throttled || run.answered) return;
    run.throttled = true;
    send(run, 'streaming', text);
    setTimeout(() => {
      run.throttled = false;
      if (run.text !== text) grow(run, run.text);
    }, STREAM_INTERVAL_MS);
  }

  function end(run: AskRun, status: RunStatus, answer: string) {
    light.release(key(run));
    asks.delete(run.askId);
    if (run.taskId && owners.get(run.source) === run.sourceId)
      endedTasks.set(run.askId, { source: run.source, taskId: run.taskId });
    send(run, finalState(status), answer || run.text);
  }

  function open(run: Pick<AskRun, 'taskId'>) {
    if (!run.taskId) return;
    const panel = host();
    panel.openTask(run.taskId);
    panel.reveal();
  }

  async function ask({ askId, source, sourceId, question, files }: RecordingAsk) {
    if (asks.has(askId)) return;
    if (owners.get(source) !== sourceId) {
      owners.set(source, sourceId);
      for (const [id, ended] of endedTasks) if (ended.source === source) endedTasks.delete(id);
    }
    const run: AskRun = {
      askId,
      source,
      sourceId,
      taskId: null,
      runId: null,
      text: '',
      throttled: false,
      answered: false,
      stopped: false,
      opened: false,
      handedOver: false,
    };
    asks.set(askId, run);
    send(run, 'thinking', '');
    let detail: TaskDetail;
    try {
      detail = await light.submit(key(run), {
        invocationId: crypto.randomUUID(),
        policy: null,
        taskId: null,
        commandId: null,
        commandRevision: null,
        savedRun: null,
        input: { ...emptyInput(), source, text: question, files },
      });
    } catch (error) {
      console.error('The result card question could not start:', error);
      light.release(key(run));
      asks.delete(askId);
      send(run, 'failed', '');
      return;
    }
    run.taskId = detail.task.id;
    run.runId = detail.task.runs.at(-1)?.id ?? null;
    if (run.stopped && run.runId) stopRun(run.taskId, run.runId);
    if (run.opened) open(run);
    followRecordingAsks({ type: 'task', state: detail }, host());
    followAnswer(detail, {
      text: (text) => grow(run, text),
      end: (status, answer) => end(run, status, answer),
    });
  }

  function stop(askId: string) {
    const run = asks.get(askId);
    if (!run) return;
    run.stopped = true;
    if (run.taskId && run.runId) stopRun(run.taskId, run.runId);
    send(run, 'stopped', run.text);
  }

  const offAsk = bridge.onAsk((event) => void ask(event));
  const offStop = bridge.onStop(stop);
  const offOpen = bridge.onOpen((askId) => {
    const run = asks.get(askId);
    if (run && !run.taskId) run.opened = true;
    else open(run ?? { taskId: endedTasks.get(askId)?.taskId ?? null });
  });
  return () => {
    offAsk();
    offStop();
    offOpen();
  };
}

/**
 * Follows the result cards' questions still running: one that asks the person something (a
 * confirmation or a question) can only go on in the panel, which then shows it; its answer keeps
 * reaching the card.
 */
export function followRecordingAsks(event: AgentEvent, host: LightHost): void {
  for (const run of asks.values()) {
    if (!run.taskId || !run.runId || run.stopped || run.handedOver) continue;
    if (!runWaits(event, run.taskId, run.runId)) continue;
    run.handedOver = true;
    host.openTask(run.taskId);
    host.reveal();
  }
}
