import { Suspense, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuoteSource } from '@atd/agent-contracts';
import type { TaskDetail } from '../../client/agent/bridge';
import type { PermissionRequest } from '../../client/agent/permission-schema';
import type { RunPolicy } from '../../client/agent/run-policy';
import type { FileRef } from '../../client/agent/task-schema';
import type { Connection, ModelReference } from '../../client/providers/schema';
import { lazyWithPreload } from '../../lib/lazy-with-preload';
import type { useNextStepsHost } from './next-steps/use-next-steps-host';
import type { useSideChat } from './side-chat/use-side-chat';
import { CodeHighlightPool } from './transcript/code-highlight-pool';
import { SubagentContext, type SubagentContextValue } from './transcript/subagent-context';
import { Transcript } from './transcript/transcript';
import { ConversationPlaceholder } from './transcript/transcript-placeholder';
import type { useChildView } from './use-child-view';

const childTranscriptView = lazyWithPreload(() =>
  import('./transcript/child-transcript-view').then((module) => module.ChildTranscriptView),
);
const sideChatLayer = lazyWithPreload(() =>
  import('./side-chat/side-chat-layer').then((module) => module.SideChatLayer),
);

const ChildTranscriptView = childTranscriptView.Component;
const SideChatLayer = sideChatLayer.Component;

export interface TaskStageProps {
  detail: TaskDetail;
  subagents: SubagentContextValue;
  child: ReturnType<typeof useChildView>;
  side: ReturnType<typeof useSideChat>;
  requests: PermissionRequest[];
  policy: RunPolicy;
  pending: boolean;
  connections: Connection[];
  model: ModelReference | null;
  nextSteps: ReturnType<typeof useNextStepsHost>;
  onAttach: (file: FileRef) => void;
  onNewTask: () => void;
  onOpenTask: (taskId: string) => void;
  onRemember: (text: string) => void;
  onQuote: (markdown: string, source: QuoteSource | undefined) => void;
}

/**
 * The open conversation's transcript stage, code-highlight worker pool, subagent drill-in, and
 * side-chat overlay, split out of the initial welcome bundle.
 */
export function TaskStage({
  detail,
  subagents,
  child,
  side,
  requests,
  policy,
  pending,
  connections,
  model,
  nextSteps,
  onAttach,
  onNewTask,
  onOpenTask,
  onRemember,
  onQuote,
}: TaskStageProps) {
  const { t } = useTranslation('panel');
  useEffect(() => {
    void childTranscriptView.preload();
    void sideChatLayer.preload();
  }, []);

  if (child.childKey) void childTranscriptView.preload();
  if (side.view) void sideChatLayer.preload();

  return (
    <CodeHighlightPool>
      <SubagentContext value={subagents}>
        <Transcript
          detail={detail}
          covered={child.childKey !== null || side.view !== null}
          onAttach={onAttach}
          onNewTask={onNewTask}
          onOpenTask={onOpenTask}
          onRemember={onRemember}
          onQuote={onQuote}
          onCommand={side.runCommand}
          nextSteps={nextSteps}
        />
        {child.childKey && (
          <Suspense
            fallback={
              <ConversationPlaceholder
                label={t('header.loadingConversation')}
                className="child-conversation"
              />
            }
          >
            <ChildTranscriptView
              key={child.childKey}
              taskId={detail.task.id}
              taskTitle={detail.task.title}
              childKey={child.childKey}
              requests={requests}
              onBack={child.close}
              // The composer is hidden under the drill-in, so a quote returns to it. Its passage
              // stays in the subagent's view, which the chip cannot reopen.
              onQuote={(markdown) => {
                child.close();
                onQuote(markdown, undefined);
              }}
              onRemember={onRemember}
              onCommand={side.runCommand}
            />
          </Suspense>
        )}
      </SubagentContext>
      {side.view && (
        <Suspense fallback={null}>
          <SideChatLayer
            key={side.view.id}
            side={side}
            view={side.view}
            conversationTitle={detail.task.title}
            policy={policy}
            pending={pending}
            connections={connections}
            model={model}
            onAttach={onAttach}
            onQuote={onQuote}
            onRemember={onRemember}
            onOpenTask={onOpenTask}
            onNewTask={onNewTask}
          />
        </Suspense>
      )}
    </CodeHighlightPool>
  );
}
