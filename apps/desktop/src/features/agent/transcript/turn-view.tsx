import { memo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Artifact, FileRef, TaskRun } from '../../../client/agent/task-schema';
import { TaskFiles } from '../task-files';
import type { AdaptedTurn } from './adapter';
import { ActivityGroup } from './activity-group';
import { BlockView } from './block-view';
import { McpApprovalBanners } from './mcp-approval-banner';
import { promptRun } from './run-prompt';
import { buildLiveText } from './token-rate';
import { TurnActions } from './turn-actions';
import { TurnHeader } from './turn-header';
import type { RequestIndex } from './turns';
import { UserMessage } from './user-message';

/**
 * The turn's final answer: the last assistant text. A stopped turn can end in tool activity or an
 * empty aborted message, so the copied answer is not always the last block.
 */
function lastAnswerText(turn: AdaptedTurn): string {
  for (let index = turn.items.length - 1; index >= 0; index -= 1) {
    const item = turn.items[index];
    if (item?.type === 'block' && item.block.kind === 'assistant' && item.block.text.trim())
      return item.block.text;
  }
  return '';
}

/** Every step of the turn's activity groups, in order. */
function activitySteps(items: AdaptedTurn['items']) {
  return items.flatMap((item) => (item.type === 'activity' ? item.view : []));
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

/**
 * One turn. Memoized: the adapter keeps a settled turn's object across patches, so only the turn
 * a patch touched renders again while the answer streams.
 */
export const TurnView = memo(function TurnView({
  turn,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  last,
  copyable = true,
  modelName,
  status,
  onAttach,
}: {
  turn: AdaptedTurn;
  runs: TaskRun[];
  artifacts: Artifact[];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  last: boolean;
  /**
   * Offer the message and turn actions (copy, edit, regenerate, exports); a subagent's drill-in
   * view leaves them to its parent.
   */
  copyable?: boolean;
  /** Names the model instead of the turn's run; a subagent's view knows its child's own model. */
  modelName?: string;
  /** The run's terminal note (stopped, failed) on the last turn, above its action bar. */
  status?: ReactNode;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const settled = !(live && last);
  const openId = settled ? null : openActivityId(turn.items);
  const liveFooter = live && last;
  // Streamed prose for the live rate estimate; only the live footer reads it.
  const liveText = liveFooter ? buildLiveText(turn.view.map((view) => view.source)) : undefined;
  const sectionClass = `transcript-turn${liveFooter ? ' transcript-turn-live' : ''}`;
  const run = turn.user ? promptRun(runs, turn.user) : undefined;
  return (
    <section className={sectionClass}>
      {turn.user && <UserMessage user={turn.user} run={run} last={last} copyable={copyable} />}
      {(liveFooter || settled) && (
        <TurnHeader
          startedAt={turn.startedAt}
          durationMs={turn.durationMs}
          modelName={modelName ?? turn.modelName}
          live={liveFooter}
          waiting={liveFooter ? turn.waiting : null}
          trueTokens={turn.trueTokens}
          trueDurationMs={turn.trueDurationMs}
          liveText={liveText}
          usage={liveFooter ? null : turn.usage}
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
            <BlockView block={item.block} requests={requests} />
            {files.length > 0 && <TaskFiles files={files} onAttach={onAttach} />}
          </div>
        );
      })}
      {status}
      {/* Collected from every activity group and held until the turn settles, so the banners sit
          together above the actions instead of interrupting the stream; the approval only
          applies from the next message anyway. */}
      {settled && <McpApprovalBanners steps={activitySteps(turn.items)} />}
      {/* Held back only while this turn streams; earlier turns keep theirs during a run. */}
      {settled && copyable && (
        <TurnActions turn={turn} run={run} answer={lastAnswerText(turn)} last={last} />
      )}
    </section>
  );
});
