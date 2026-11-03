import type { TaskRun } from '../../../client/agent/task-schema';
import type { OutgoingMessage } from '../outgoing-messages';
import { modelNameForRun, type AdaptedTurn } from './adapter';
import { inputMessageText, pendingMessageText } from './run-prompt';
import { measureTurn } from './token-rate';
import type { TurnWaitingKind } from './turn-header';

/**
 * Presentation of an accepted run before its prompt block arrives. This is a local projection,
 * never a persisted block or an editable entry. TurnList keys both versions by the prompt's run,
 * so the real prompt updates the existing bubble and clock instead of remounting them.
 */
export function pendingTurn(run: TaskRun, waiting: TurnWaitingKind): AdaptedTurn {
  return promptTurn(
    run.id,
    Date.parse(run.createdAt),
    pendingMessageText(run.snapshot),
    modelNameForRun(run),
    waiting,
  );
}

/**
 * Presentation of a follow-up the service has not taken yet (`outgoing-messages.ts`), as its
 * accepted run's `pendingTurn` will show it: its text, and its model by id, which is how a run
 * frozen now names it (`modelNameForRun`). With no run yet, the invocation id stands in for the
 * prompt's run: no run has that id, so the bubble shows its own text, and TurnList keys it as it
 * keys the run that takes it over.
 */
export function outgoingTurn(message: OutgoingMessage): AdaptedTurn {
  const text = inputMessageText(message.input);
  return promptTurn(message.id, message.sentAt, text, message.model?.modelId ?? '', null);
}

function promptTurn(
  runId: string,
  timestamp: number,
  text: string,
  modelName: string,
  waiting: TurnWaitingKind,
): AdaptedTurn {
  const id = `pending:${runId}`;
  return {
    id,
    user: { kind: 'user', id, runId, timestamp, endedAt: timestamp, text, prompt: true },
    items: [],
    view: [],
    startedAt: timestamp,
    durationMs: null,
    waiting,
    modelName,
    generation: measureTurn([]),
    usage: null,
  };
}
