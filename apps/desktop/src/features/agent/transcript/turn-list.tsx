import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import type { TaskDetail } from '../../../client/agent/bridge';
import type { FileRef, TaskRun } from '../../../client/agent/task-schema';
import type { AdaptedTurn } from './adapter';
import { pendingTurn } from './pending-turn';
import { createTurnArrivalHistory } from './turn-arrival';
import type { TurnWaitingKind } from './turn-header';
import { TurnView } from './turn-view';
import type { RequestIndex } from './turns';

/** Accepted and persisted prompts share their run's identity through the handoff. */
function turnKey(turn: AdaptedTurn): string {
  return turn.user?.prompt ? `prompt:${turn.user.runId}` : turn.id;
}

export function TurnList({
  turns,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  status,
  pending,
  waiting,
  firstVisible,
  sentinel,
  loadEarlier,
  onAttach,
}: {
  turns: AdaptedTurn[];
  runs: TaskRun[];
  artifacts: TaskDetail['artifacts'];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  status: ReactNode;
  pending: TaskRun | undefined;
  waiting: TurnWaitingKind;
  /** The window `useEarlierTurns` keeps: the first turn shown, and its load-earlier control. */
  firstVisible: number;
  sentinel: (element: HTMLElement | null) => void;
  loadEarlier: () => void;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const listed = pending ? [...turns, pendingTurn(pending, waiting)] : turns;
  // Seed from the complete snapshot, including turns the history window has not mounted.
  const [arrivals] = useState(() => createTurnArrivalHistory(listed.map(turnKey)));
  const firstPrompt = listed.find((turn) => turn.user);
  const visibleTurns = listed.slice(firstVisible);
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
      {visibleTurns.map((turn, index) => (
        <TurnView
          key={turnKey(turn)}
          arrivalHistory={arrivals}
          arrivalId={turnKey(turn)}
          promptArrives={turn !== firstPrompt}
          turn={turn}
          runs={runs}
          artifacts={artifacts}
          anchors={anchors}
          requests={requests}
          live={live}
          last={firstVisible + index === listed.length - 1}
          pending={Boolean(pending && firstVisible + index === turns.length)}
          status={firstVisible + index === listed.length - 1 ? status : null}
          onAttach={onAttach}
        />
      ))}
    </>
  );
}
