import { useTranslation } from 'react-i18next';
import type { Artifact, FileRef, TaskRun } from '../../../../electron/agent/task-schema';
import { TaskFiles } from '../task-files';
import type { AdaptedTurn } from './adapter';
import { ActivityGroup } from './activity-group';
import { BlockView } from './block-view';
import { PromptMessage } from './prompt-message';
import { promptRun } from './run-prompt';
import { TurnHeader } from './turn-header';
import type { RequestIndex } from './turns';

function lastAssistantId(turn: AdaptedTurn): string | null {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.type === 'block' && item.block.kind === 'assistant') return item.block.id;
  }
  return null;
}

/**
 * The activity group whose round of work is still going: the last group of a live turn, until
 * the answer or any other block follows it. Between steps — a tool finished, the next message
 * not yet streaming — no block in the group is live, so liveness alone would flash the settled
 * tally mid-round.
 */
function openActivityId(items: AdaptedTurn['items']): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    if (item.type === 'activity') return item.id;
    // An answer that has not produced text yet has not ended the work.
    if (item.block.kind !== 'assistant' || item.block.text.trim() !== '') return null;
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
  copyable = true,
  onAttach,
}: {
  turn: AdaptedTurn;
  runs: TaskRun[];
  artifacts: Artifact[];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  last: boolean;
  /** Offer copying the settled answer; a subagent's drill-in view leaves that to its parent. */
  copyable?: boolean;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const copyId = live || !copyable ? null : lastAssistantId(turn);
  const settled = !(live && last);
  const openId = settled ? null : openActivityId(turn.items);
  const liveFooter = live && last;
  const sectionClass = `transcript-turn${liveFooter ? ' transcript-turn-live' : ''}`;
  const run = turn.user ? promptRun(runs, turn.user) : undefined;
  return (
    <section className={sectionClass}>
      {turn.user && (
        <article className="user-message" aria-label={t('conversation.yourMessage')}>
          {run ? (
            <PromptMessage snapshot={run.snapshot} fallback={turn.user.text} />
          ) : (
            <div className="message-bubble">{turn.user.text}</div>
          )}
        </article>
      )}
      {(liveFooter || settled) && (
        <TurnHeader
          startedAt={turn.startedAt}
          durationMs={turn.durationMs}
          modelName={turn.modelName}
          live={liveFooter}
          waiting={liveFooter ? turn.waiting : null}
          trueTokens={turn.trueTokens}
          trueDurationMs={turn.trueDurationMs}
          liveText={turn.liveText}
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
              // A group still holding a running call or a pending request stays live even
              // after prose follows it.
              active={!settled && (item.id === openId || item.live)}
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
