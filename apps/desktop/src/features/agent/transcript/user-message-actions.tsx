import type { Ref } from 'react';
import { Check, Copy, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../../components/icon-button';
import { useCopyFeedback } from './use-copy-feedback';

/**
 * The row under a user bubble, revealed on hover or keyboard focus: Copy takes the message, Edit
 * opens it for replacement. Edit is disabled rather than left out while the message cannot be
 * edited — a run is going, or the message is still pending — so the row keeps one shape from the
 * moment the message is sent and nothing shifts when it becomes editable.
 */
export function UserMessageActions({
  copyText,
  onEdit,
  editRef,
}: {
  copyText: string;
  /** Opens the editor; `null` while the message cannot be edited. */
  onEdit: (() => void) | null;
  editRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation('tasks');
  const copy = useCopyFeedback();
  return (
    <div
      className="message-actions user-message-actions"
      data-reveal="hover"
      data-pinned={copy.pinned || undefined}
    >
      <IconButton
        label={copy.copied ? t('conversation.copied') : t('turnActions.copyMessage')}
        tooltipPinned={copy.pinned}
        onPointerLeave={copy.unpin}
        onClick={() => void copy.copy(copyText)}
      >
        {copy.copied ? <Check /> : <Copy />}
      </IconButton>
      <IconButton
        ref={editRef}
        label={t('turnActions.edit')}
        disabled={!onEdit}
        onClick={() => onEdit?.()}
      >
        <Pencil />
      </IconButton>
    </div>
  );
}
