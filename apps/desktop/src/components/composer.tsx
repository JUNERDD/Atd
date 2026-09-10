import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { DEFAULT_SHORTCUTS } from '../../electron/settings-contract';
import type { ProviderSettings, ShortcutBindings } from '../../electron/settings-contract';
import { ArrowUp, Plus, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { IconButton } from './icon-button';
import { ComposerConfiguration } from './composer-configuration';
import { VoiceInputButton } from './voice-input-button';
import { MAX_ATTACHMENTS, MAX_PROMPT_LENGTH, type Attachment } from '../lib/task-store';
import { acceleratorToHotkey } from '../lib/shortcuts';
import './composer.css';

interface ComposerProps {
  onSubmit: (prompt: string, attachments: Attachment[]) => void;
  focusOnMount?: boolean;
  shortcuts?: ShortcutBindings;
  provider?: ProviderSettings;
  onOpenSettings?: () => void;
}

export function Composer({
  onSubmit,
  focusOnMount = false,
  shortcuts = DEFAULT_SHORTCUTS,
  provider,
  onOpenSettings,
}: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentLimitExceeded, setAttachmentLimitExceeded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSubmit = prompt.trim().length > 0 || attachments.length > 0;
  const expanded = prompt.includes('\n');
  const platform = window.desktop?.platform ?? 'web';
  const hotkeyOptions: Options = {
    delimiter: '|',
    useKey: false,
    enableOnFormTags: ['textarea'],
    // Retain send's default prevention for held keys without submitting again.
    enabled: (event) => !event.repeat,
    ignoreEventWhen: (event) =>
      event.defaultPrevented || event.isComposing || event.keyCode === 229,
  };

  useEffect(() => {
    if (focusOnMount) textarea.current?.focus();
  }, [focusOnMount]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    onSubmit(prompt, attachments);
    setPrompt('');
    setAttachments([]);
    setAttachmentLimitExceeded(false);
    textarea.current?.focus();
  }

  const sendMessageRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.sendMessage, platform),
    () => submit(),
    { ...hotkeyOptions, preventDefault: true },
    [prompt, attachments, onSubmit],
  );
  const newLineRef = useHotkeys<HTMLTextAreaElement>(
    acceleratorToHotkey(shortcuts.newLine, platform),
    (event) => {
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      event.preventDefault();
      const input = textarea.current;
      if (!input) return;
      const { selectionStart: start, selectionEnd: end } = input;
      const next = `${prompt.slice(0, start)}\n${prompt.slice(end)}`;
      if (next.length > MAX_PROMPT_LENGTH) return;
      setPrompt(next);
      requestAnimationFrame(() => textarea.current?.setSelectionRange(start + 1, start + 1));
    },
    hotkeyOptions,
    [prompt],
  );
  const setTextareaRef = useCallback(
    (input: HTMLTextAreaElement | null) => {
      textarea.current = input;
      sendMessageRef(input);
      newLineRef(input);
    },
    [sendMessageRef, newLineRef],
  );

  return (
    <footer className="panel-footer">
      <form className="composer" aria-label="New task" onSubmit={submit}>
        <div
          className="composer-surface"
          data-expanded={expanded}
          data-has-attachments={attachments.length > 0}
        >
          <Textarea
            ref={setTextareaRef}
            className="composer-input"
            aria-label="Task prompt"
            placeholder="Ask anything…"
            rows={1}
            wrap={expanded ? 'soft' : 'off'}
            maxLength={MAX_PROMPT_LENGTH}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          {attachments.length > 0 && (
            <ul className="attachment-list" aria-label="Attached context">
              {attachments.map((attachment) => (
                <li className="attachment-chip" key={attachment.id}>
                  <span title={attachment.name}>{attachment.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() =>
                      setAttachments((files) => files.filter((file) => file.id !== attachment.id))
                    }
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose context files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              const remaining = MAX_ATTACHMENTS - attachments.length;
              setAttachmentLimitExceeded(files.length > remaining);
              setAttachments((previous) => [
                ...previous,
                ...files.slice(0, remaining).map((file) => ({
                  id: crypto.randomUUID(),
                  name: file.name,
                  size: file.size,
                  type: file.type,
                })),
              ]);
              event.target.value = '';
            }}
          />
          <IconButton
            label="Attach context"
            className="composer-attach"
            tooltipSide="top"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Plus />
          </IconButton>
          <div className="composer-actions">
            <VoiceInputButton />
            <Button type="submit" size="icon-sm" aria-label="Send task" disabled={!canSubmit}>
              <ArrowUp />
            </Button>
          </div>
        </div>
        <ComposerConfiguration provider={provider} onOpenSettings={onOpenSettings} />
        {attachmentLimitExceeded === true && (
          <output className="composer-notice">You can attach up to {MAX_ATTACHMENTS} files.</output>
        )}
      </form>
    </footer>
  );
}
