import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTaskAgent } from '@atd/agent-contracts';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import type { PermissionRequest } from '../../../client/agent/permission-schema';
import type { Artifact, TaskRun } from '../../../client/agent/task-schema';
import { TaskAgentMenu } from '../task-agents/task-agent-menu';
import { TaskAgentDetails, TemporaryBadge } from '../task-agents/task-agent-role';
import { agentDisplayName } from '../task-agents/task-agents';
import { adaptTranscript } from './adapter';
import { LayerHeader } from './layer-header';
import { ScrollJump } from './scroll-jump';
import { useQuoteReveal } from './selection-toolbar/quote-reveal';
import { SelectionToolbar } from './selection-toolbar/selection-toolbar';
import { useSubagents } from './subagent-context';
import { TurnView } from './turn-view';
import { indexRequests } from './turns';
import { useChildTranscript } from './use-child-transcript';
import type { CommandOpener } from './use-offered-commands';
import { useTranscriptScroll } from './use-transcript-scroll';

/** A load shorter than this shows nothing rather than flashing the loading line. */
const LOADING_DELAY_MS = 400;

/** The drill-in view owns no files: task files anchor in the parent conversation only. */
const NO_ANCHORS = new Set<string>();
const NO_ARTIFACTS: Artifact[] = [];
const noAttach = () => {};
/** Child blocks carry the parent's run id, so the parent's runs would name the wrong model. */
const NO_RUNS: TaskRun[] = [];

/**
 * A subagent's full conversation laid over the parent transcript: the same turn, activity and
 * answer rendering, fed from the child's own transcript subscription. Pending approvals come
 * from the task-level requests because the child's tool calls raise them on the parent task;
 * the transcript only labels them, and the parent's composer (hidden while this view is open)
 * answers them. Its header names where it sits ("task › agent") with the way back; a task agent's
 * child marks the agent Temporary, and with the definition from the parent transcript's define
 * row, its name opens the agent's role and the More menu saves the agent as one of the user's
 * subagents. Text selected in an answer offers the same actions as in the parent transcript;
 * `onQuote` lands in that composer, so the caller closes this view to show it.
 */
export function ChildTranscriptView({
  taskId,
  taskTitle,
  childKey,
  requests,
  onBack,
  onQuote,
  onRemember,
  onCommand,
}: {
  taskId: string;
  taskTitle: string;
  childKey: string;
  requests: PermissionRequest[];
  onBack: () => void;
  /** Adds selected answer text to the parent's reply draft as a quote chip. */
  onQuote?: (markdown: string) => void;
  /** Starts a memory session seeded with selected answer text. */
  onRemember?: (text: string) => void;
  /** Opens a command offered on selected answer text; without it no command is offered. */
  onCommand?: CommandOpener;
}) {
  const { t } = useTranslation('tasks');
  const { index, agents } = useSubagents();
  const child = index.byKey.get(childKey);
  const taskAgent = child && isTaskAgent(child.agent);
  const definition = taskAgent ? agents.get(child.agent) : undefined;
  const { detail, error } = useChildTranscript(taskId, childKey);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (detail || error) return;
    const timer = setTimeout(() => setSlow(true), LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [detail, error]);
  const requestIndex = useMemo(() => indexRequests(requests), [requests]);
  const blocks = detail?.blocks;
  const model = child?.model ?? '';
  // The child's own model from its summary labels its turns instead of a run's.
  const turns = useMemo(
    () => (blocks ? adaptTranscript(blocks, requestIndex, NO_RUNS) : []),
    [blocks, requestIndex],
  );
  const live = child ? child.status === 'running' : Boolean(detail?.live);
  const { viewportRef, showJump, pin, onScroll } = useTranscriptScroll(detail?.revision ?? 0);
  const [messages, setMessages] = useState<HTMLDivElement | null>(null);
  // The reveal layer: empty for React, painted by a quote chip's reveal (quote-overlay.ts).
  const [revealLayer, setRevealLayer] = useState<HTMLDivElement | null>(null);
  useQuoteReveal(messages, revealLayer);

  return (
    <div className="conversation child-conversation">
      <LayerHeader
        parentTitle={taskTitle}
        title={(child && agentDisplayName(child.agent)) || t('subagent.fallbackName')}
        backLabel={t('subagent.back')}
        breadcrumbLabel={t('subagent.breadcrumb')}
        onBack={onBack}
        mark={taskAgent && <TemporaryBadge />}
        details={definition && <TaskAgentDetails definition={definition} />}
        actions={definition && <TaskAgentMenu definition={definition} />}
      />
      <ScrollArea
        viewportRef={viewportRef}
        className="min-h-0 flex-1"
        viewportClassName="overlay-footer-fade"
        gutter="none"
        scrollShadow
        viewportProps={{ onScroll }}
      >
        <div ref={setMessages} className="conversation-messages">
          {turns.map((turn, position) => (
            <TurnView
              key={turn.id}
              turn={turn}
              runs={NO_RUNS}
              artifacts={NO_ARTIFACTS}
              anchors={NO_ANCHORS}
              requests={requestIndex}
              live={live}
              last={position === turns.length - 1}
              copyable={false}
              modelName={model}
              onAttach={noAttach}
            />
          ))}
          {error ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {error}
            </p>
          ) : !detail ? (
            slow && <p className="m-0 text-sm text-muted-foreground">{t('subagent.loading')}</p>
          ) : (
            turns.length === 0 && (
              <p className="m-0 text-sm text-muted-foreground">{t('subagent.empty')}</p>
            )
          )}
          <div ref={setRevealLayer} className="quote-reveal-layer" aria-hidden />
        </div>
      </ScrollArea>
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
