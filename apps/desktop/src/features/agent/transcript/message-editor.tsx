import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { isComposingKey } from '@ai/ui/lib/ime';
import type { RunSnapshot } from '../../../client/agent/task-schema';
import { UserContext } from '../user-context';

const NO_CHIP_FILES: ReadonlySet<string> = new Set();

/**
 * Edits a sent message in place of its bubble. ⌘↩ sends and Esc cancels; an IME composition keeps
 * both keys. Every file of the run stays listed above the field, chip files included, because the
 * resend keeps them all. `last` is false for an earlier message, which the note warns is replaced
 * together with everything after it. The owner closes the editor once a send succeeds.
 */
export function MessageEditor({
  initialText,
  snapshot,
  last,
  canSend,
  onCancel,
  onSend,
}: {
  initialText: string;
  /** The run whose prompt is edited; a queued follow-up has none and resends text only. */
  snapshot: RunSnapshot | undefined;
  last: boolean;
  /** Whether `text` (with the run's files) is something to send. */
  canSend: (text: string) => boolean;
  onCancel: () => void;
  onSend: (text: string) => Promise<void>;
}) {
  const { t } = useTranslation('tasks');
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const sendable = canSend(text) && !pending;

  // Opening the editor moves focus into it, with the caret after the text.
  useEffect(() => {
    const node = field.current;
    node?.focus();
    node?.setSelectionRange(node.value.length, node.value.length);
  }, []);

  async function send() {
    if (!sendable) return;
    setPending(true);
    try {
      await onSend(text);
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isComposingKey(event)) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    } else if (event.key === 'Escape') {
      // Handled here, so the panel's own Escape (leave the task) does not run as well.
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  }

  return (
    <div className="message-editor">
      {snapshot && <UserContext snapshot={snapshot} chipFileIds={NO_CHIP_FILES} />}
      <Textarea
        aria-label={t('turnActions.editLabel')}
        ref={field}
        value={text}
        className="max-h-60"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {!last && <p className="m-0 text-xs text-muted-foreground">{t('turnActions.editNote')}</p>}
      <div className="message-editor-actions">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('turnActions.cancel')}
        </Button>
        <Button
          size="sm"
          disabled={!sendable}
          aria-keyshortcuts="Meta+Enter"
          onClick={() => void send()}
        >
          {t('turnActions.send')}
        </Button>
      </div>
    </div>
  );
}
