import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import type { QuoteSource } from '@ai/agent-contracts';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { TaskDetail } from '../../../client/agent/bridge';
import { isActive, type FileRef, type TaskRun } from '../../../client/agent/task-schema';
import { compactBlock } from '../compaction/compact-availability';
import { NewTaskHint } from '../compaction/new-task-hint';
import { useCompactTask } from '../compaction/use-compact-task';
import { adaptTranscript, type AdaptedTurn } from './adapter';
import { CompactionRetryContext, type CompactionRetry } from './compaction-context';
import { artifactAnchorIds, indexRequests, sameIds, type RequestIndex } from './turns';
import { PendingTurn } from './pending-turn';
import { ScrollJump } from './scroll-jump';
import { pendingPromptRun } from './run-prompt';
import { useQuoteReveal } from './selection-toolbar/quote-reveal';
import { SelectionToolbar } from './selection-toolbar/selection-toolbar';
import { StatusBar } from './status-bar';
import { TaskTurnsContext, type TaskTurns } from './turn-context';
import { TurnView } from './turn-view';
import { useTranscriptScroll } from './use-transcript-scroll';

const VISIBLE_TURNS = 20;

function TurnList({
  turns,
  runs,
  artifacts,
  anchors,
  requests,
  live,
  status,
  onAttach,
}: {
  turns: AdaptedTurn[];
  runs: TaskRun[];
  artifacts: TaskDetail['artifacts'];
  anchors: Set<string>;
  requests: RequestIndex;
  live: boolean;
  status: ReactNode;
  onAttach: (file: FileRef) => void;
}) {
  const { t } = useTranslation('tasks');
  const [visibleCount, setVisibleCount] = useState(VISIBLE_TURNS);
  const firstVisible = Math.max(0, turns.length - visibleCount);
  const visibleTurns = turns.slice(firstVisible);
  return (
    <>
      {firstVisible > 0 && (
        <div className="load-earlier">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVisibleCount((count) => count + VISIBLE_TURNS)}
          >
            {firstVisible === 1
              ? t('transcript.loadEarlier.action')
              : t('transcript.loadEarlier.actionWithCount', { count: firstVisible })}
          </Button>
        </div>
      )}
      {visibleTurns.map((turn, index) => (
        <TurnView
          key={turn.id}
          turn={turn}
          runs={runs}
          artifacts={artifacts}
          anchors={anchors}
          requests={requests}
          live={live}
          last={firstVisible + index === turns.length - 1}
          status={firstVisible + index === turns.length - 1 ? status : null}
          onAttach={onAttach}
        />
      ))}
    </>
  );
}

/**
 * The task's conversation. `covered` keeps it laid out but invisible and inert while a subagent's
 * drill-in view sits on top, so expanded rows, loaded turns and the scroll offset survive the
 * round trip without being restored by hand (a `display: none` box would drop the offset).
 * A failed compaction row retries through this task; after repeated compactions the end of the
 * conversation suggests `onNewTask`. Turn actions that leave the transcript (opening a fork,
 * starting a memory session) go through the panel's `onOpenTask` and `onRemember`; text selected in
 * an answer can be quoted into the reply through `onQuote`.
 */
export function Transcript({
  detail,
  covered = false,
  onAttach,
  onNewTask,
  onOpenTask,
  onRemember,
  onQuote,
}: {
  detail: TaskDetail;
  covered?: boolean;
  onAttach: (file: FileRef) => void;
  /** Starts a new task; without it the repeated-compaction hint stays hidden. */
  onNewTask?: () => void;
  /** Shows another task; without it turns offer no fork. */
  onOpenTask?: (taskId: string) => void;
  /** Starts a memory session seeded with a turn's answer; without it turns offer no Remember. */
  onRemember?: (text: string) => void;
  /** Adds selected answer text to the reply draft as a quote chip; without it there is no Quote. */
  onQuote?: (markdown: string, source: QuoteSource | undefined) => void;
}): ReactElement {
  const { t } = useTranslation('tasks');
  const { t: tPanel } = useTranslation('panel');
  const { task, blocks, artifacts, requests } = detail;
  const run = task.runs.at(-1);
  const live = isActive(run?.status);
  const requestIndex = useMemo(() => indexRequests(requests), [requests]);
  // Renderer-side reshape after the patch apply. Every streamed patch replaces `blocks`, so this
  // reruns per patch; the adapter hands back unchanged turns as the same objects, and only the
  // turn a patch touched renders again.
  const turns = useMemo(
    () => adaptTranscript(blocks, requestIndex, task.runs),
    [blocks, requestIndex, task.runs],
  );
  // Held by value: the anchor set rarely changes while blocks do on every patch, and a new set
  // would render every memoized turn again.
  const nextAnchors = useMemo(() => artifactAnchorIds(blocks, artifacts), [blocks, artifacts]);
  const [anchors, setAnchors] = useState(nextAnchors);
  if (anchors !== nextAnchors && !sameIds(anchors, nextAnchors)) setAnchors(nextAnchors);
  const { viewportRef, showJump, pin, onScroll } = useTranscriptScroll(detail.revision);
  const [messages, setMessages] = useState<HTMLDivElement | null>(null);
  // The reveal layer: empty for React, painted by a quote chip's reveal (quote-overlay.ts).
  const [revealLayer, setRevealLayer] = useState<HTMLDivElement | null>(null);
  useQuoteReveal(messages, revealLayer);
  // The latest run before its prompt reaches the transcript: it closes the conversation as its
  // own turn, so the turns above stay settled instead of borrowing its live header and note.
  const pending = pendingPromptRun(task.runs, blocks);
  const pendingFiles = pending ? artifacts.filter((file) => file.runId === pending.id) : [];
  const headRequest = requests[0];
  const { compact, pending: compacting } = useCompactTask();
  const retryBlocked = compacting || compactBlock(task, detail.context) !== null;
  const latestCompaction = blocks.findLast((block) => block.kind === 'compaction')?.id ?? null;
  const retry = useMemo<CompactionRetry>(
    () => ({ retry: () => void compact(task.id), disabled: retryBlocked, latestCompaction }),
    [compact, task.id, retryBlocked, latestCompaction],
  );
  // The compiler keeps this object while its fields hold: it changes with the task's runs and
  // title, not per streamed patch, so the turns' action rows stay put while an answer streams.
  const turnTask: TaskTurns = {
    taskId: task.id,
    title: task.title,
    runs: task.runs,
    busy: live,
    openTask: onOpenTask,
    remember: onRemember,
  };

  return (
    <div className="conversation" data-covered={covered || undefined} inert={covered}>
      <ScrollArea
        viewportRef={viewportRef}
        className="flex-1 min-h-0"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
        viewportProps={{ onScroll }}
      >
        <div ref={setMessages} className="conversation-messages">
          {task.legacy && (
            <div className="legacy-note">
              <p className="text-sm">{t('conversation.legacyTitle')}</p>
              <ScrollArea
                className="input-preview"
                viewportClassName="max-h-[inherit]"
                scrollShadow
              >
                <div>{task.legacy.prompt}</div>
              </ScrollArea>
              {task.legacy.attachments.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('conversation.legacyAttachments', {
                    files: task.legacy.attachments.map((file) => file.name).join(', '),
                  })}
                </p>
              )}
            </div>
          )}
          <CompactionRetryContext value={retry}>
            <TaskTurnsContext value={turnTask}>
              <TurnList
                key={task.id}
                turns={turns}
                runs={task.runs}
                artifacts={artifacts}
                anchors={anchors}
                requests={requestIndex}
                live={live && !pending}
                status={pending ? null : <StatusBar run={run} />}
                onAttach={onAttach}
              />
            </TaskTurnsContext>
          </CompactionRetryContext>
          {pending && (
            <PendingTurn
              run={pending}
              live={live}
              waiting={headRequest?.kind === 'input' ? 'answer' : headRequest ? 'approval' : null}
              files={pendingFiles}
              onAttach={onAttach}
            />
          )}
          {onNewTask && (
            <NewTaskHint
              key={task.id}
              taskId={task.id}
              compactions={detail.context.compactions}
              onNewTask={onNewTask}
            />
          )}
          {(detail.capabilities?.length ?? 0) > 0 && (
            <output className="text-sm text-muted-foreground">
              {tPanel('capability.waitingDesktop', {
                capability: detail.capabilities!.map((cap) => cap.capability).join(', '),
              })}
            </output>
          )}
          <div ref={setRevealLayer} className="quote-reveal-layer" aria-hidden />
        </div>
      </ScrollArea>
      <ScrollJump show={showJump} onJump={pin} />
      <SelectionToolbar root={messages} onQuote={onQuote} onRemember={onRemember} />
    </div>
  );
}
