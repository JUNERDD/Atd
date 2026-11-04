import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import type { TaskDetail } from '../../../client/agent/bridge';
import type { FileRef, TaskRun } from '../../../client/agent/task-schema';
import type { OutgoingMessage } from '../outgoing-messages';
import type { AdaptedTurn } from './adapter';
import { OutgoingFailure } from './outgoing-failure';
import { createTurnArrivalHistory } from './turn-arrival';
import { TurnView } from './turn-view';
import type { RequestIndex } from './turns';

/**
 * Prompts key by their run's invocation, which the panel picks before it sends: an outgoing
 * message, its accepted run and the persisted prompt keep one identity through both handoffs, so
 * each updates the bubble and clock in place instead of remounting them.
 */
function turnKey(turn: AdaptedTurn, invocations: ReadonlyMap<string, string>): string {
  if (!turn.user?.prompt) return turn.id;
  return `prompt:${invocations.get(turn.user.runId) ?? turn.user.runId}`;
}

export function TurnList({
  turns,
  drawnFrom,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  status,
  outgoing,
  firstVisible,
  sentinel,
  loadEarlier,
  onAttach,
}: {
  /** Every listed turn: the conversation's own, then any drawn before their prompt arrives. */
  turns: AdaptedTurn[];
  /**
   * Where the drawn turns start: the latest run's while its prompt has not arrived
   * (`pendingTurn`), then a follow-up on its way (`outgoingTurn`).
   */
  drawnFrom: number;
  runs: TaskRun[];
  artifacts: TaskDetail['artifacts'];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  /** The latest run's terminal note, closing the conversation. */
  status: ReactNode;
  /**
   * A follow-up the service has not taken yet, the last turn: live until it fails, when its
   * failure closes the conversation. Like its run once accepted, it retires the latest run's note.
   */
  outgoing: OutgoingMessage | undefined;
  /** The window `useEarlierTurns` keeps: the first turn shown, and its load-earlier control. */
  firstVisible: number;
  sentinel: (element: HTMLElement | null) => void;
  loadEarlier: () => void;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const invocations = new Map(runs.map((run) => [run.id, run.invocationId]));
  // Seed from the complete snapshot, including turns the history window has not mounted.
  const [arrivals] = useState(() =>
    createTurnArrivalHistory(turns.map((turn) => turnKey(turn, invocations))),
  );
  const firstPrompt = turns.find((turn) => turn.user);
  const visibleTurns = turns.slice(firstVisible);
  return (
    <>
      {/* Scrolling near it loads the batch; the button stays for keyboard and assistive use. */}
      {firstVisible > 0 && (
        <div ref={sentinel} className="load-earlier">
          <Button variant="outline" size="sm" onClick={loadEarlier}>
            {firstVisible === 1
              ? t('transcript.loadEarlier.action')
              : t('transcript.loadEarlier.actionWithCount', { count: firstVisible })}
          </Button>
        </div>
      )}
      {visibleTurns.map((turn, index) => {
        const position = firstVisible + index;
        const last = position === turns.length - 1;
        const sending = outgoing && last ? outgoing : undefined;
        const note = outgoing
          ? sending &&
            sending.error !== null && <OutgoingFailure message={sending} error={sending.error} />
          : last && status;
        return (
          <TurnView
            key={turnKey(turn, invocations)}
            arrivalHistory={arrivals}
            arrivalId={turnKey(turn, invocations)}
            promptArrives={turn !== firstPrompt}
            turn={turn}
            runs={runs}
            artifacts={artifacts}
            anchors={anchors}
            requests={requests}
            live={sending ? sending.error === null : live}
            last={last}
            pending={position >= drawnFrom}
            status={note}
            onAttach={onAttach}
          />
        );
      })}
    </>
  );
}
