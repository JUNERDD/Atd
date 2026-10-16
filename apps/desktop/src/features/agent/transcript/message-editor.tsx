import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { ScrollArea } from '@atd/ui/components/scroll-area';
import { Textarea } from '@atd/ui/components/textarea';
import { isComposingKey } from '@atd/ui/lib/ime';
import type { RunSnapshot } from '../../../client/agent/task-schema';
import { UserContext } from '../user-context';

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
  const viewport = useRef<HTMLDivElement>(null);
  /** Watches the field while the editor opens, until `settle` stops it. */
  const opening = useRef<ResizeObserver | null>(null);
  const sendable = canSend(text) && !pending;

  // Opening the editor moves focus into it, with the caret after the text, and scrolls a long
  // text's end, where the caret is, into view. The end moves after that first scroll: the scroll
  // area adds its bar lane once it sees the text overflow, so the text wraps narrower and grows (a
  // frame later on engines without CSS `field-sizing`, where script sizes the field). Each change
  // of the field's size scrolls the end back into view, until the user acts in the field.
  useEffect(() => {
    const node = field.current;
    const box = viewport.current;
    if (!node || !box) return;
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
    const revealEnd = () => {
      box.scrollTop = box.scrollHeight;
    };
    revealEnd();
    const observer = new ResizeObserver(revealEnd);
    observer.observe(node);
    opening.current = observer;
    return () => observer.disconnect();
  }, []);

  /** The user's first scroll, press, key or edit in the field's scroll area ends the reveal. */
  function settle() {
    opening.current?.disconnect();
    opening.current = null;
  }

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
      {snapshot && <UserContext snapshot={snapshot} />}
      {/* The field grows with the text; past 240px the shared ScrollArea scrolls it, so the
          bar matches the transcript's. */}
      <ScrollArea
        className="panel-text-scroll"
        viewportClassName="max-h-[inherit]"
        viewportRef={viewport}
        onPointerDownCapture={settle}
        onWheelCapture={settle}
        onKeyDownCapture={settle}
      >
        <Textarea
          aria-label={t('turnActions.editLabel')}
          ref={field}
          value={text}
          className="overflow-hidden"
          onChange={(event) => {
            settle();
            setText(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </ScrollArea>
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
