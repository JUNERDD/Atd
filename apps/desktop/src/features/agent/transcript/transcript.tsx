import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { QuoteSource } from '@atd/agent-contracts';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { TaskDetail } from '../../../client/agent/bridge';
import { isActive, type FileRef } from '../../../client/agent/task-schema';
import { compactBlock } from '../compaction/compact-availability';
import { NewTaskHint } from '../compaction/new-task-hint';
import { useCompactTask } from '../compaction/use-compact-task';
import { TaskViewsContext, useViewSnapshots, type TaskViews } from '../generative-views/view-fold';
import { adaptTranscript } from './adapter';
import { CompactionRetryContext, type CompactionRetry } from './compaction-context';
import {
  publishConversationControls,
  withdrawConversationControls,
  type ConversationControls,
} from './conversation-controls';
import { ConversationFind } from './conversation-find';
import { artifactAnchorIds, indexRequests, sameIds } from './turns';
import { ScrollJump } from './scroll-jump';
import { pendingPromptRun } from './run-prompt';
import { useQuoteReveal } from './selection-toolbar/quote-reveal';
import { SelectionToolbar } from './selection-toolbar/selection-toolbar';
import { StatusBar } from './status-bar';
import { TaskTurnsContext, type TaskTurns } from './turn-context';
import { TurnList } from './turn-list';
import { useEarlierTurns } from './use-earlier-turns';
import type { CommandOpener } from './use-offered-commands';
import { usePromptNav } from './use-prompt-nav';
import { usePromptStepKeys } from './use-prompt-step-keys';
import { useTranscriptScroll } from './use-transcript-scroll';

/**
 * The task's conversation. `covered` keeps it laid out but invisible and inert while a subagent's
 * drill-in view sits on top, so expanded rows, loaded turns and the scroll offset survive the
 * round trip without being restored by hand (a `display: none` box would drop the offset).
 * A failed compaction row retries through this task; after repeated compactions the end of the
 * conversation suggests `onNewTask`. Turn actions that leave the transcript (opening a fork,
 * starting a memory session) go through the panel's `onOpenTask` and `onRemember`; text selected in
 * an answer can be quoted into the reply through `onQuote`. The commands offered on an answer, or
 * on text selected in one, open through `onCommand`. While shown and not covered it publishes its
 * controls (`conversation-controls.ts`): the composer's message entry steps through its user
 * messages, mounted or not, and the header opens its find bar (`ConversationFind`).
 */
export function Transcript({
  detail,
  covered = false,
  onAttach,
  onNewTask,
  onOpenTask,
  onRemember,
  onQuote,
  onCommand,
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
  /** Opens an offered command on an answer or a selection; without it no command is offered. */
  onCommand?: CommandOpener;
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
  const { viewportRef, showJump, pin, reveal, revealDirection, onScroll } = useTranscriptScroll(
    detail.revision,
  );
  const { firstVisible, sentinel, loadEarlier, include } = useEarlierTurns(
    turns.length,
    viewportRef,
    task.id,
  );
  const nav = usePromptNav({
    turns,
    runs: task.runs,
    fallback: t('conversation.yourMessage'),
    viewportRef,
    firstVisible,
    include,
    reveal,
    revealDirection,
    pin,
    atBottom: !showJump,
  });
  usePromptStepKeys(!covered && nav.prompts.length > 1, nav.step);
  // The find bar's state, started over for another task.
  const [find, setFind] = useState({ taskId: task.id, open: false, request: 0 });
  if (find.taskId !== task.id) setFind({ taskId: task.id, open: false, request: 0 });
  const openFind = useCallback(
    () => setFind((state) => ({ ...state, open: true, request: state.request + 1 })),
    [],
  );
  const closeFind = () => setFind((state) => ({ ...state, open: false }));
  useEffect(() => {
    if (covered) return;
    const controls: ConversationControls = {
      taskId: task.id,
      prompts: nav.prompts,
      active: nav.active,
      show: nav.show,
      step: nav.step,
      viewport: viewportRef.current,
      openFind,
    };
    publishConversationControls(controls);
    return () => withdrawConversationControls(controls);
  }, [covered, task.id, nav.prompts, nav.active, nav.show, nav.step, viewportRef, openFind]);
  const [messages, setMessages] = useState<HTMLDivElement | null>(null);
  // The reveal layer: empty for React, painted by a quote chip's reveal (quote-overlay.ts).
  const [revealLayer, setRevealLayer] = useState<HTMLDivElement | null>(null);
  useQuoteReveal(messages, revealLayer);
  // The latest run before its prompt reaches the transcript: it closes the conversation as its
  // own turn, so the turns above stay settled instead of borrowing its live header and note.
  const pending = pendingPromptRun(task.runs, blocks);
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
    runCommand: onCommand,
  };
  // Each view's data, folded from the whole transcript: a later turn's update reaches a view card
  // in a settled turn, which the adapter keeps as it was.
  const views = useViewSnapshots(blocks);
  const taskViews: TaskViews = { taskId: task.id, views };

  return (
    <div className="conversation" data-covered={covered || undefined} inert={covered}>
      <ScrollArea
        viewportRef={viewportRef}
        className="min-h-0 flex-1"
        viewportClassName="overlay-footer-fade transcript-viewport"
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
              <TaskViewsContext value={taskViews}>
                <TurnList
                  key={task.id}
                  turns={turns}
                  runs={task.runs}
                  artifacts={artifacts}
                  anchors={anchors}
                  requests={requestIndex}
                  live={live}
                  status={<StatusBar run={run} />}
                  pending={pending}
                  waiting={
                    headRequest?.kind === 'input' ? 'answer' : headRequest ? 'approval' : null
                  }
                  firstVisible={firstVisible}
                  sentinel={sentinel}
                  loadEarlier={loadEarlier}
                  onAttach={onAttach}
                />
              </TaskViewsContext>
            </TaskTurnsContext>
          </CompactionRetryContext>
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
      <ConversationFind
        open={find.open}
        focusRequest={find.request}
        onOpen={openFind}
        onClose={closeFind}
        viewportRef={viewportRef}
        root={messages}
        turnCount={turns.length}
        include={include}
        covered={covered}
      />
      <ScrollJump show={showJump} onJump={pin} />
      <SelectionToolbar
        root={messages}
        onQuote={onQuote}
        onRemember={onRemember}
        onCommand={onCommand}
      />
    </div>
  );
}
