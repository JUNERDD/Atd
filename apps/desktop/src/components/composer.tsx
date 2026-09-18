import { useCallback, useEffect, useRef, useState } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { useTranslation } from 'react-i18next';
import { ArrowUp, Plus, Square, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import type { ShortcutBindings } from '../../electron/settings-contract';
import { DEFAULT_SHORTCUTS } from '../../electron/settings-contract';
import type { AgentTask, FileRef, RunStatus } from '../../electron/agent/task-schema';
import { isActive } from '../../electron/agent/task-schema';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import { EMPTY_QUEUE, type QueueState } from '../../electron/agent/transcript-schema';
import type { Connection, ModelReference } from '../../electron/providers/schema';
import type { RunPolicy } from '../../electron/agent/run-policy';
import { IconButton } from './icon-button';
import { ComposerConfiguration } from './composer-configuration';
import { ComposerQueue } from './composer-queue';
import { useOverlayFooter } from './use-overlay-footer';
import { acceleratorToHotkey } from '../lib/shortcuts';
import { agentApi } from '../features/agent/use-agent';
import { showErrorToast } from './toast-store';
import './composer.css';

export interface ComposerDraft {
  text: string;
  files: FileRef[];
}
export interface ComposerProps {
  policy: RunPolicy;
  onPolicyChange: (policy: RunPolicy) => void;
  draft: ComposerDraft;
  onChange: (draft: ComposerDraft) => void;
  onSubmit: () => Promise<unknown>;
  onStop?: () => Promise<void>;
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
}

function pendingInputOf(requests: PermissionRequest[]) {
  return requests.find((request) => request.kind === 'input');
}

function joinDraft(current: string, incoming: string) {
  return current.trim() ? `${current}\n${incoming}` : incoming;
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
}: ComposerProps) {
  const { t } = useTranslation('panel');
  const footerRef = useOverlayFooter<HTMLElement>();
  const [choosing, setChoosing] = useState(false);
  const [sending, setSending] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const hasContent = Boolean(draft.text.trim() || draft.files.length);
  const active = isActive(status);
  const locked = status === 'stopping' || status === 'queued';
  const pendingInput = active && !locked ? pendingInputOf(requests) : undefined;
  const pendingRequest = active && requests.length > 0;
  const label = active
    ? status === 'stopping'
      ? t('composer.stopping')
      : status === 'queued'
        ? t('composer.cancelStarting')
        : pendingRequest
          ? t('composer.stopAndDecline')
          : t('composer.stop')
    : t('composer.send');
  const sendDisabled = pending || sending || locked || (active ? !draft.text.trim() : !hasContent);
  const stopDisabled = pending || status === 'stopping' || !onStop;
  const disabled = active ? stopDisabled : sendDisabled;
  const platform = window.desktop?.platform ?? 'web';
  const expanded = draft.text.includes('\n') || draft.text.length > 90;
  const options: Options = {
    delimiter: '|',
    useKey: false,
    enableOnFormTags: ['textarea'],
    enabled: (event) => !event.repeat && !locked,
    ignoreEventWhen: (event) =>
      event.defaultPrevented || event.isComposing || event.keyCode === 229,
  };
  async function send() {
    if (sendDisabled) return;
    try {
      if (active) {
        if (draft.files.length) throw new Error(t('composer.attachAfterRun'));
        const text = draft.text.trim();
        if (!taskId || !text) return;
        setSending(true);
        try {
          if (pendingInput)
            await agentApi().answer(taskId, pendingInput.runId, pendingInput.id, { answer: text });
          else await agentApi().queueMessage(taskId, text, 'followUp');
          onChange({ ...draft, text: '' });
        } finally {
          setSending(false);
        }
        return;
      }
      await onSubmit();
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function stop() {
    if (stopDisabled) return;
    const followUps = queue.followUp;
    try {
      await onStop?.();
      if (followUps.length)
        onChange({ ...draft, text: joinDraft(draft.text, followUps.join('\n')) });
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function act() {
    if (active) await stop();
    else await send();
  }
  const sendRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.sendMessage, platform),
    () => void send(),
    { ...options, preventDefault: true },
    [draft, sendDisabled, active, pendingInput, taskId, onSubmit],
  );
  const newLineRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.newLine, platform),
    (event) => {
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      const input = textarea.current;
      if (!input) return;
      const { selectionStart: start, selectionEnd: end } = input;
      onChange({ ...draft, text: `${draft.text.slice(0, start)}\n${draft.text.slice(end)}` });
      requestAnimationFrame(() => textarea.current?.setSelectionRange(start + 1, start + 1));
    },
    options,
    [draft, onChange],
  );
  const ref = useCallback(
    (input: HTMLTextAreaElement | null) => {
      textarea.current = input;
      sendRef(input);
      newLineRef(input);
    },
    [sendRef, newLineRef],
  );
  useEffect(() => {
    textarea.current?.focus();
  }, []);
  async function choose() {
    setChoosing(true);
    try {
      const files = await agentApi().chooseFiles();
      if (draft.files.length + files.length > 10) throw new Error(t('composer.attachLimit'));
      onChange({ ...draft, files: [...draft.files, ...files] });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setChoosing(false);
    }
  }
  const placeholder = pendingInput
    ? t('composer.answerPlaceholder')
    : followup
      ? t('composer.followUpPlaceholder')
      : t('composer.placeholder');
  return (
    <footer ref={footerRef} className="panel-footer overlay-footer">
      <form
        className="composer"
        aria-label={followup ? t('composer.followUpForm') : t('composer.newTaskForm')}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div
          className="composer-surface"
          data-expanded={expanded}
          data-has-attachments={draft.files.length > 0}
          data-has-queue={queue.steering.length + queue.followUp.length > 0}
        >
          {taskId && (
            <ComposerQueue
              taskId={taskId}
              queue={queue}
              disabled={locked || sending}
              onEdit={(text) => onChange({ ...draft, text: joinDraft(draft.text, text) })}
            />
          )}
          <ScrollArea className="composer-input-scroll" viewportClassName="max-h-[inherit]" gutter>
            <Textarea
              ref={ref}
              className="composer-input"
              data-panel-autofocus="true"
              aria-label={t('composer.promptLabel')}
              placeholder={placeholder}
              rows={1}
              wrap={expanded ? 'soft' : 'off'}
              maxLength={pendingInput ? 10000 : 100000}
              disabled={locked}
              value={draft.text}
              onChange={(event) => onChange({ ...draft, text: event.target.value })}
            />
          </ScrollArea>
          {draft.files.length > 0 && (
            <ScrollArea className="composer-attachments" viewportClassName="max-h-[inherit]" gutter>
              <ul className="attachment-list" aria-label={t('composer.attachedContext')}>
                {draft.files.map((file) => (
                  <li className="attachment-chip" key={file.id}>
                    <span title={file.name}>{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('composer.removeFile', { name: file.name })}
                      onClick={() =>
                        onChange({
                          ...draft,
                          files: draft.files.filter((item) => item.id !== file.id),
                        })
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          )}
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
        <ComposerConfiguration
          connections={connections}
          model={model}
          onOpenSettings={onOpenSettings}
          policy={policy}
          onPolicyChange={onPolicyChange}
          taskId={taskId}
          task={task}
        />
      </form>
    </footer>
  );
}
