import type { TaskRun } from '../../../client/agent/task-schema';
import { modelNameForRun, type AdaptedTurn } from './adapter';
import { pendingMessageText } from './run-prompt';
import { measureTurn } from './token-rate';
import type { TurnWaitingKind } from './turn-header';

/**
 * Presentation of an accepted run before its prompt block arrives. This is a local projection,
 * never a persisted block or an editable entry. TurnList keys both versions by the prompt's run,
 * so the real prompt updates the existing bubble and clock instead of remounting them.
 */
export function pendingTurn(run: TaskRun, waiting: TurnWaitingKind): AdaptedTurn {
  const timestamp = Date.parse(run.createdAt);
  const id = `pending:${run.id}`;
  return {
    id,
    user: {
      kind: 'user',
      id,
      runId: run.id,
      timestamp,
      endedAt: timestamp,
      text: pendingMessageText(run.snapshot),
      prompt: true,
    },
    items: [],
    view: [],
    startedAt: timestamp,
    durationMs: null,
    waiting,
    modelName: modelNameForRun(run),
    generation: measureTurn([]),
    usage: null,
  };
}
