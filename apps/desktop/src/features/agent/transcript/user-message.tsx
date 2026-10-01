import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../client/agent/task-schema';
import type { BlockOf } from '../../../client/agent/transcript-schema';
import { IconButton } from '../../../components/icon-button';
import { showErrorToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';
import { MessageBubble } from './message-bubble';
import { MessageEditor } from './message-editor';
import { PromptMessage } from './prompt-message';
import { useTaskTurns } from './turn-context';
import { canResend, editableText, promptText, replacementRequest } from './turn-resend';
import { useCopyFeedback } from './use-copy-feedback';

/**
 * A turn's user message: a run's prompt as composed (`run`), or a queued follow-up as plain text.
 * Under the bubble, revealed on hover or keyboard focus, Copy takes the message and Edit (for a
 * persisted message of an idle task) swaps the bubble for an editor whose Send replaces the
 * message, branching the task before it. `copyable` is false in a subagent's view, which offers
 * no message actions.
 */
export function UserMessage({
  user,
  run,
  last,
  copyable,
}: {
  user: BlockOf<'user'>;
  run: TaskRun | undefined;
  last: boolean;
  copyable: boolean;
}) {
  const { t } = useTranslation('tasks');
  const task = useTaskTurns();
  const copy = useCopyFeedback();
  const [editing, setEditing] = useState(false);
  /** Cancelling returns focus to Edit, which only exists again once the bubble is back. */
  const restoreFocus = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const entryId = user.entryId;
  const editable = Boolean(task && entryId && !task.busy);
  // A run that starts meanwhile (another window sent a message) keeps the editor and its text but
  // holds Send until the run ends: the branch point must not move under a replacement.
  const open = editing && Boolean(task && entryId);

  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    editButton.current?.focus();
  }, [open]);

  function close() {
    restoreFocus.current = true;
    setEditing(false);
  }

  async function send(text: string) {
    if (!task || !entryId) return;
    try {
      await agentApi().submit(
        replacementRequest(task.taskId, { ...user, entryId }, task.runs, run, text),
      );
      setEditing(false);
    } catch (error) {
      // The editor stays open with the text, for another try.
      showErrorToast(error);
    }
  }

  return (
    <article className="user-message" aria-label={t('conversation.yourMessage')}>
      {open ? (
        <MessageEditor
          initialText={editableText(user, run)}
          snapshot={run?.snapshot}
          last={last}
          canSend={(text) => !task?.busy && canResend(text, run)}
          onCancel={close}
          onSend={send}
        />
      ) : (
        <>
          {run ? (
            <PromptMessage snapshot={run.snapshot} fallback={user.text} />
          ) : (
            <MessageBubble>{user.text}</MessageBubble>
          )}
          {copyable && (
            <div
              className="message-actions user-message-actions"
              data-reveal="hover"
              data-pinned={copy.pinned || undefined}
            >
              <IconButton
                label={copy.copied ? t('conversation.copied') : t('turnActions.copyMessage')}
                tooltipPinned={copy.pinned}
                onPointerLeave={copy.unpin}
                onClick={() => void copy.copy(promptText(user, run))}
              >
                {copy.copied ? <Check /> : <Copy />}
              </IconButton>
              {editable && (
                <IconButton
                  ref={editButton}
                  label={t('turnActions.edit')}
                  onClick={() => setEditing(true)}
                >
                  <Pencil />
                </IconButton>
              )}
            </div>
          )}
        </>
      )}
    </article>
  );
}
