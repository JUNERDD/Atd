import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Plus, Square } from 'lucide-react';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { ShortcutBindings } from '../../electron/settings-contract';
import { DEFAULT_SHORTCUTS, type TaskContextState } from '@ai/agent-contracts';
import type { AgentTask, RunStatus } from '../../electron/agent/task-schema';
import { isActive } from '../../electron/agent/task-schema';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import { EMPTY_QUEUE, type Block, type QueueState } from '../../electron/agent/transcript-schema';
import type { Connection, ModelReference } from '../../electron/providers/schema';
import type { RunPolicy } from '../../electron/agent/run-policy';
import { draftFiles, normalizeDraft, type ComposerDraft } from '../features/composer-editor/draft';
import type { ComboboxAria } from '../features/composer-editor/editor-state';
import { useComposerEditor } from '../features/composer-editor/use-composer-editor';
import { QUICK_COMMAND_IDS, type QuickActions } from '../features/quick-panel/quick-commands';
import { QuickPanel } from '../features/quick-panel/quick-panel';
import type { TriggerState } from '../features/quick-panel/trigger';
import { isQuickPanelOpen, type QuickPanelHandle } from '../features/quick-panel/use-quick-panel';
import { IconButton } from './icon-button';
import { ComposerAttachments } from './composer-attachments';
import { ComposerConfiguration } from './composer-configuration';
import { ComposerPopover } from './composer-popover';
import { useOverlayFooter } from './use-overlay-footer';
import { agentApi } from '../features/agent/use-agent';
import { compactBlock } from '../features/agent/compaction/compact-availability';
import { useCompactTask } from '../features/agent/compaction/use-compact-task';
import { showErrorToast } from './toast-store';
import './composer.css';

export interface ComposerProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  draft: ComposerDraft;
  onChange: (draft: ComposerDraft) => void;
  onSubmit: () => Promise<unknown>;
  /** Resolves with the queued messages Stop withdrew; they return to the draft. */
  onStop?: () => Promise<QueueState>;
  status?: RunStatus;
  pending?: boolean;
  followup?: boolean;
  shortcuts?: ShortcutBindings;
  connections: Connection[];
  model: ModelReference | null;
  onOpenSettings: () => void;
  taskId?: string | null;
  runId?: string;
  task?: AgentTask | null;
  requests?: PermissionRequest[];
  queue?: QueueState;
  /** The open task's transcript; the progress pill above the input derives from it. */
  blocks?: readonly Block[];
  /** The open task's context usage: the usage ring, `/compact`, and the pill's compacting part. */
  context?: TaskContextState | null;
  /** Panel actions the `/new` and `/history` quick commands run. */
  quickActions: QuickActions;
  /** Snapshot tasks: `@` conversations and recently attached files. */
  tasks: readonly AgentTask[];
  /** The panel body below the header, which the quick panel must not leave. */
  overlayBoundary: Element | null;
  /**
   * Hides the composer without unmounting it, while a read-only view (a subagent's transcript)
   * covers the task: the draft, the open popover state and the focus-return target survive.
   */
  hidden?: boolean;
}

const NO_BLOCKS: readonly Block[] = [];

function pendingInputOf(requests: PermissionRequest[]) {
  return requests.find((request) => request.kind === 'input');
}

function joinDraft(current: string, incoming: string) {
  return current.trim() ? `${current}\n${incoming}` : incoming;
}

/**
 * Sends text while a run is active. A pending input takes it as the answer; paused on an approval,
 * the message cuts in (the service declines what is waiting and delivers it now); otherwise it
 * queues behind the reply.
 */
async function deliverDuringRun(
  taskId: string,
  text: string,
  pendingInput: PermissionRequest | undefined,
  steer: boolean,
) {
  if (pendingInput)
    await agentApi().answer(taskId, pendingInput.runId, pendingInput.id, { answer: text });
  else await agentApi().queueMessage(taskId, text, steer ? 'steer' : 'followUp');
}

export function Composer({
  draft,
  onChange,
  onSubmit,
  onStop,
  status,
  pending = false,
  followup = false,
  shortcuts = DEFAULT_SHORTCUTS,
  connections,
  model,
  onOpenSettings,
  policy,
  onPolicyChange,
  taskId = null,
  task = null,
  requests = [],
  queue = EMPTY_QUEUE,
  blocks = NO_BLOCKS,
  context = null,
  quickActions,
  tasks,
  overlayBoundary,
  hidden = false,
}: ComposerProps) {
  const { t } = useTranslation('panel');
  const footerRef = useOverlayFooter<HTMLElement>();
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [aria, setAria] = useState<ComboboxAria | null>(null);
  // Bumped by `/queue`: the popover reopens whenever the count changes.
  const [queueRecall, setQueueRecall] = useState(0);
  const panel = useRef<QuickPanelHandle>(null);
  const { compact } = useCompactTask();
  const hasContent = Boolean(draft.text.trim() || draft.files.length);
  const active = isActive(status);
  const locked = status === 'stopping' || status === 'queued';
  // Harmless fallback: the popover owns the primary answer path (chips + free text), but Enter in
  // the composer still answers a pending input for typists. Both call the same request-scoped
  // `answer`, so the first success retires the request and the other path goes idle.
  const pendingInput = active && !locked ? pendingInputOf(requests) : undefined;
  const pendingRequest = active && requests.length > 0;
  const waiting =
    requests.length > 0 || (taskId !== null && queue.steering.length + queue.followUp.length > 0);
  // The IPC limits: an answer takes 10000 characters, a message or queued follow-up 100000.
  const limit = pendingInput ? 10000 : 100000;
  const label = active
    ? status === 'stopping'
      ? t('composer.stopping')
      : status === 'queued'
        ? t('composer.cancelStarting')
        : pendingRequest
          ? t('composer.stopAndDecline')
          : t('composer.stop')
    : t('composer.send');
  const sendDisabled =
    pending ||
    sending ||
    locked ||
    draft.text.length > limit ||
    (active ? !draft.text.trim() : !hasContent);
  const stopDisabled = pending || status === 'stopping' || !onStop;
  const disabled = active ? stopDisabled : sendDisabled;
  const platform = window.desktop?.platform ?? 'web';
  const expanded = draft.text.includes('\n') || draft.text.length > 90;
  /** Plain-text edits from outside the editor; chips they break are dropped. */
  const setText = (text: string) => onChange(normalizeDraft({ ...draft, text }));
  // The handlers below catch every error and reset their flags after the try statement: React
  // Compiler 1.0 leaves a component uncompiled for `finally`, `throw`, or conditional expressions
  // inside `try`.
  async function send() {
    if (sendDisabled) return;
    if (!active) {
      try {
        await onSubmit();
      } catch (error) {
        showErrorToast(error);
      }
      return;
    }
    // Queued messages and answers are plain text, so chips wait for the run to finish.
    if (draft.files.length) return showErrorToast(t('composer.attachAfterRun'));
    if (draft.chips.length) return showErrorToast(t('composer.chipsAfterRun'));
    const text = draft.text.trim();
    if (!taskId || !text) return;
    setSending(true);
    try {
      await deliverDuringRun(taskId, text, pendingInput, pendingRequest);
      setText('');
    } catch (error) {
      showErrorToast(error);
    }
    setSending(false);
  }
  async function stop() {
    if (stopDisabled || !onStop) return;
    try {
      // Restore what the service withdrew, not the last queue shown: Pi may have delivered an
      // item in the meantime, and a pending steer ("send now") is withdrawn too.
      const unsent = await onStop();
      const restored = [...unsent.steering, ...unsent.followUp];
      if (restored.length) setText(joinDraft(draft.text, restored.join('\n')));
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function act() {
    if (active) await stop();
    else await send();
  }
  async function choose() {
    setChoosing(true);
    try {
      const files = await agentApi().chooseFiles();
      // The attachment row and file chips share the 10-file limit.
      if (draftFiles(draft).length + files.length > 10) showErrorToast(t('composer.attachLimit'));
      else onChange({ ...draft, files: [...draft.files, ...files] });
    } catch (error) {
      showErrorToast(error);
    }
    setChoosing(false);
  }
  const placeholder = pendingInput
    ? t('composer.answerPlaceholder')
    : pendingRequest
      ? t('composer.interjectPlaceholder')
      : followup
        ? t('composer.followUpPlaceholder')
        : t('composer.placeholder');
  const { container: editorContainer, commands: editorCommands } = useComposerEditor({
    draft,
    onChange,
    onTrigger: setTrigger,
    onSend: () => void send(),
    panel,
    shortcuts,
    platform,
    quickCommands: QUICK_COMMAND_IDS,
    wrap: expanded,
    locked,
    limit,
    label: t('composer.promptLabel'),
    placeholder,
    aria,
  });
  return (
    <footer ref={footerRef} className="panel-footer overlay-footer" hidden={hidden}>
      <form
        className="composer"
        aria-label={followup ? t('composer.followUpForm') : t('composer.newTaskForm')}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <ComposerPopover
          requests={requests}
          queue={queue}
          taskId={taskId}
          queueDisabled={locked || sending}
          recall={queueRecall}
          // Hidden, a new approval still reaches the pill; its popover opens once shown again.
          hidden={hidden}
          suppressed={isQuickPanelOpen(trigger, active)}
          blocks={blocks}
          // A queued run has not started, so the latest reply still belongs to the last run.
          live={active && status !== 'queued'}
          compacting={context?.compacting ?? false}
          onEditQueued={(text) => setText(joinDraft(draft.text, text))}
        >
          <QuickPanel
            trigger={trigger}
            running={active}
            pending={waiting}
            editor={editorCommands}
            handleRef={panel}
            onAriaChange={setAria}
            actions={{
              ...quickActions,
              openSettings: onOpenSettings,
              showQueue: () => setQueueRecall((count) => count + 1),
              compact: (instructions) => {
                if (taskId) void compact(taskId, instructions);
              },
            }}
            compact={compactBlock(task, context)}
            policy={policy}
            onPolicyChange={onPolicyChange}
            connections={connections}
            model={model}
            attachmentCount={draftFiles(draft).length}
            taskId={taskId}
            tasks={tasks}
            boundary={overlayBoundary}
          >
            <div
              className="composer-surface"
              data-expanded={expanded}
              data-has-attachments={draft.files.length > 0}
            >
              <ScrollArea
                className="composer-input-scroll"
                viewportClassName="max-h-[inherit]"
                gutter="stable"
              >
                <div ref={editorContainer} className="composer-input" />
              </ScrollArea>
              <ComposerAttachments
                files={draft.files}
                onRemove={(id) =>
                  onChange({ ...draft, files: draft.files.filter((file) => file.id !== id) })
                }
              />
              <IconButton
                label={t('composer.attachContext')}
                className="composer-attach"
                tooltipSide="top"
                variant="secondary"
                disabled={choosing || locked}
                onClick={() => void choose()}
              >
                <Plus />
              </IconButton>
              <div className="composer-actions">
                <IconButton
                  label={label}
                  variant="default"
                  tooltipSide="top"
                  disabled={disabled}
                  onClick={() => void act()}
                >
                  {active ? <Square className="fill-current size-3" /> : <ArrowUp />}
                </IconButton>
              </div>
            </div>
          </QuickPanel>
        </ComposerPopover>
        <ComposerConfiguration
          connections={connections}
          model={model}
          onOpenSettings={onOpenSettings}
          policy={policy}
          onPolicyChange={onPolicyChange}
          taskId={taskId}
          task={task}
          context={context}
        />
      </form>
    </footer>
  );
}
