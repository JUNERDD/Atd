import { useTranslation } from 'react-i18next';
import type { Artifact, FileRef, TaskRun } from '../../../../electron/agent/task-schema';
import { UserContext } from '../user-context';
import { TaskFiles } from '../task-files';
import type { AdaptedTurn } from './adapter';
import { ActivityGroup } from './activity-group';
import { BlockView } from './block-view';
import { activityStillRunning, lastActivityIndex } from './phases';
import { runById } from './run-prompt';
import { TurnHeader } from './turn-header';
import type { RequestIndex } from './turns';

function lastAssistantId(turn: AdaptedTurn): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.type === 'block' && item.block.kind === 'assistant') return item.block.id;
  }
  return null;
}

export function TurnView({
  turn,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  last,
  onAttach,
}: {
  turn: AdaptedTurn;
  runs: TaskRun[];
  artifacts: Artifact[];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  last: boolean;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const copyId = live ? null : lastAssistantId(turn);
  const settled = !(live && last);
  // Where the work ends and the answer begins: the last group of activity in the turn. The agent
  // starting its answer is the end of the work — fold the groups then, not when the turn finally
  // settles, so the collapse never lands under text already being read.
  const foldedAt = lastActivityIndex(turn.items);
  const answering =
    foldedAt >= 0 &&
    turn.items
      .slice(foldedAt + 1)
      .some(
        (item) =>
          item.type === 'block' && item.block.kind === 'assistant' && item.block.text.trim() !== '',
      );
  const done = settled || (answering && !activityStillRunning(turn.view));
  const liveFooter = live && last;
  const sectionClass = `transcript-turn${liveFooter ? ' transcript-turn-live' : ''}`;
  return (
    <section className={sectionClass}>
      {turn.user && (
        <article className="user-message" aria-label={t('conversation.yourMessage')}>
          <UserContext snapshot={runById(runs, turn.user.runId)?.snapshot} />
          <div className="message-bubble">{turn.user.text}</div>
        </article>
      )}
      {(liveFooter || settled) && (
        <TurnHeader
          startedAt={turn.startedAt}
          durationMs={turn.durationMs}
          modelName={turn.modelName}
          live={liveFooter}
          waiting={liveFooter ? turn.waiting : null}
        />
      )}
      {turn.items.map((item) => {
        if (item.type === 'activity') {
          return (
            <ActivityGroup
              key={item.id}
              item={item}
              requests={requests}
              artifacts={artifacts}
              anchors={anchors}
              onAttach={onAttach}
              done={done}
            />
          );
        }
        const files = anchors.has(item.block.id)
          ? artifacts.filter((file) => file.runId === item.block.runId)
          : [];
        const assistant = item.block.kind === 'assistant';
        return (
          <div
            key={item.block.id}
            className={assistant ? 'assistant-message' : undefined}
            aria-label={assistant ? t('conversation.assistantResponse') : undefined}
          >
            <BlockView block={item.block} requests={requests} showCopy={item.block.id === copyId} />
            {files.length > 0 && <TaskFiles files={files} onAttach={onAttach} />}
          </div>
        );
      })}
    </section>
  );
}
