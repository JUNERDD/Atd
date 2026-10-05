import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { QuoteSource } from '@atd/agent-contracts';
import type { RunPolicy } from '../../../client/agent/run-policy';
import type { FileRef } from '../../../client/agent/task-schema';
import type { Connection, ModelReference } from '../../../client/providers/schema';
import { openCommandSettings } from '../../commands/open-command-settings';
import { CommandInput } from '../command-input';
import { ChildTranscriptView } from '../transcript/child-transcript-view';
import { LayerHeader } from '../transcript/layer-header';
import { SubagentContext } from '../transcript/subagent-context';
import { Transcript } from '../transcript/transcript';
import { useAgent } from '../use-agent';
import { focusPanelInput } from '../use-panel-window';
import type { SideChat, SideChatView } from './use-side-chat';

/** A start or load shorter than this shows nothing rather than flashing its line. */
const LINE_DELAY_MS = 400;

/** A quiet line where the side chat's conversation will sit, once its start or load takes a while. */
function PendingLine({ text }: { text: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), LINE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="conversation">
      <div className="conversation-messages side-chat-pending">
        {slow && <output className="text-sm text-muted-foreground">{text}</output>}
      </div>
    </div>
  );
}

/**
 * A side chat laid over the conversation, which stays mounted and covered under it: the way back
 * and where it sits ("conversation › command"), then the command's input step, a quiet line while
 * its run starts, or the side chat's own conversation, whose follow-ups, approvals and Stop belong
 * to the panel's composer meanwhile. The side chat's subagent views open over it in turn, so only
 * the top layer is interactive. Text and files it hands on land in that composer's draft; a
 * command chosen in it opens a sibling side chat of the same conversation.
 */
export function SideChatLayer({
  side,
  view,
  conversationTitle,
  policy,
  pending,
  connections,
  model,
  onAttach,
  onQuote,
  onRemember,
  onOpenTask,
  onNewTask,
}: {
  side: SideChat;
  /** What the side chat shows (`side.view`, which this layer shows only while set). */
  view: SideChatView;
  conversationTitle: string;
  /** The input step's run policy, as the panel stages it for the command. */
  policy: RunPolicy;
  pending: boolean;
  connections: Connection[];
  /** The model the input step's run would use. */
  model: ModelReference | null;
  onAttach: (file: FileRef) => void;
  onQuote: (markdown: string, source: QuoteSource | undefined) => void;
  onRemember: (text: string) => void;
  onOpenTask: (taskId: string) => void;
  onNewTask: () => void;
}) {
  const { t } = useTranslation('tasks');
  const { detail, child } = side;
  const layer = useRef<HTMLDivElement>(null);
  const listed = useAgent().snapshot?.tasks.find((task) => task.id === side.taskId)?.title;
  const title =
    view.phase === 'task' ? (detail?.task.title ?? listed ?? '') : view.prepared.command.name;
  const covered = child.childKey !== null;
  // Focus follows the phase: the way back takes it while a run starts (`LayerHeader`), the input
  // step's first field as the step shows (a step without one leaves it on the way back), and the
  // composer once it serves the side chat's task, whether that started here or was opened as it is.
  useEffect(() => {
    if (view.phase === 'task') {
      requestAnimationFrame(focusPanelInput);
      return;
    }
    if (view.phase !== 'input') return;
    const target =
      layer.current?.querySelector<HTMLElement>('[data-panel-autofocus]') ??
      layer.current?.querySelector<HTMLElement>('.child-header button');
    target?.focus({ preventScroll: true });
  }, [view.phase]);

  return (
    <SubagentContext value={side.subagents}>
      <div
        ref={layer}
        className="side-chat"
        data-covered={covered || undefined}
        inert={covered}
        data-figma-node="2055:124092"
      >
        <LayerHeader
          parentTitle={conversationTitle}
          title={title}
          backLabel={t('sideChat.back')}
          breadcrumbLabel={t('sideChat.breadcrumb')}
          onBack={side.close}
          takeFocus={view.phase === 'starting'}
        />
        {view.phase === 'input' ? (
          <CommandInput
            key={view.prepared.command.id}
            prepared={view.prepared}
            onChange={side.setInput}
            policy={policy}
            onRun={side.runInput}
            onOpenSettings={() => void openCommandSettings(view.prepared.command.id)}
            pending={pending}
            connections={connections}
            model={model}
          />
        ) : view.phase === 'starting' || !detail ? (
          <PendingLine
            key={view.phase}
            text={view.phase === 'starting' ? t('sideChat.starting') : t('sideChat.loading')}
          />
        ) : (
          <Transcript
            detail={detail}
            onAttach={onAttach}
            onNewTask={onNewTask}
            onOpenTask={onOpenTask}
            onRemember={onRemember}
            onQuote={onQuote}
            onCommand={side.runCommand}
          />
        )}
      </div>
      {child.childKey && detail && (
        <ChildTranscriptView
          key={child.childKey}
          taskId={detail.task.id}
          taskTitle={title}
          childKey={child.childKey}
          requests={detail.requests}
          onBack={child.close}
          // The composer is hidden under the drill-in, so a quote returns to it.
          onQuote={(markdown) => {
            child.close();
            onQuote(markdown, undefined);
          }}
          onRemember={onRemember}
          onCommand={side.runCommand}
        />
      )}
    </SubagentContext>
  );
}
