import { useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { ArrowUp, Plus, X } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { IconButton } from './icon-button';
import { MAX_ATTACHMENTS, MAX_PROMPT_LENGTH, type Attachment } from '../lib/task-store';

interface ComposerProps {
  onSubmit: (prompt: string, attachments: Attachment[]) => void;
}

export function Composer({ onSubmit }: ComposerProps) {
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSubmit = prompt.trim().length > 0 || attachments.length > 0;

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSubmit) return;
    onSubmit(prompt, attachments);
    setPrompt('');
    setAttachments([]);
    setNotice('');
    textarea.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      event.keyCode !== 229
    ) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <footer className="panel-footer">
      <form className="composer" aria-label="New task" onSubmit={submit}>
        <Textarea
          ref={textarea}
          className="prompt-input"
          aria-label="Task prompt"
          placeholder="Ask anything…"
          rows={1}
          maxLength={MAX_PROMPT_LENGTH}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
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
                  className="remove-attachment"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() =>
                    setAttachments((files) => files.filter((file) => file.id !== attachment.id))
                  }
                >
                  <X className="size-3 text-foreground" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer-controls">
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose context files"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              const remaining = MAX_ATTACHMENTS - attachments.length;
              if (files.length > remaining)
                setNotice(`You can attach up to ${MAX_ATTACHMENTS} files.`);
              else setNotice('');
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
            className="attach-button"
            onClick={() => fileInput.current?.click()}
          >
            <Plus className="size-5" />
          </IconButton>
          <span className="composer-spacer" />
          <Button
            type="submit"
            size="icon-sm"
            aria-label="Send task"
            disabled={!canSubmit}
            className="send-button"
          >
            <ArrowUp className="size-5" />
          </Button>
        </div>
        {notice && <output className="composer-notice">{notice}</output>}
      </form>
    </footer>
  );
}
