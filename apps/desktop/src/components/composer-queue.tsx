import { useState } from 'react';
import { MotionConfig, Reorder, useDragControls } from 'motion/react';
import { ArrowUp, GripVertical, LoaderCircle, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@ai/ui/components/item';
import type { QueueState } from '../client/agent/transcript-schema';
import { IconButton } from './icon-button';
import { agentApi } from '../features/agent/use-agent';
import { showErrorToast } from './toast-store';

/**
 * Queued messages above the composer. Messages being sent now (steers) lead with a spinner and
 * cannot move; follow-ups keep their send order, which dragging the grip changes. Motion's `Reorder` owns the drag and the layout animation; the list keeps the
 * dragged order locally and commits it once on drop, so the service sees one replace per move.
 * The service refuses a replace that would bring back a message it already delivered.
 */
export function ComposerQueue({
  taskId,
  queue,
  disabled = false,
  onEdit,
}: {
  taskId: string;
  queue: QueueState;
  disabled?: boolean;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation('panel');
  // Positions of `queue.followUp` in their displayed order while a move is in flight; null
  // shows the service order. A new queue from the service always wins over a local order.
  const [order, setOrder] = useState<number[] | null>(null);
  // Compared by content: task events re-send an unchanged queue as a new array, and resetting on
  // those would drop the dragged order mid-drag.
  const signature = JSON.stringify(queue.followUp);
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setOrder(null);
  }
  const shown = order ?? queue.followUp.map((_, position) => position);
  const count = queue.steering.length + queue.followUp.length;
  if (count === 0) return null;

  async function replace(followUp: string[]) {
    await agentApi().replaceQueue(taskId, followUp);
  }
  function without(index: number) {
    return queue.followUp.filter((_, item) => item !== index);
  }
  async function commit(next: number[]) {
    if (next.every((index, position) => index === position)) {
      setOrder(null);
      return;
    }
    try {
      await replace(next.map((index) => queue.followUp[index] ?? ''));
    } catch (error) {
      setOrder(null);
      showErrorToast(error);
    }
  }
  async function edit(index: number) {
    const text = queue.followUp[index];
    if (text === undefined) return;
    try {
      await replace(without(index));
      onEdit(text);
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function sendNow(index: number) {
    const text = queue.followUp[index];
    if (text === undefined) return;
    try {
      await replace(without(index));
    } catch (error) {
      showErrorToast(error);
      return;
    }
    try {
      await agentApi().queueMessage(taskId, text, 'steer');
    } catch (error) {
      // Already out of the queue: hand the text back instead of losing it.
      onEdit(text);
      showErrorToast(error);
    }
  }
  async function remove(index: number) {
    try {
      await replace(without(index));
    } catch (error) {
      showErrorToast(error);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <Reorder.Group
        axis="y"
        values={shown}
        onReorder={setOrder}
        className="composer-queue"
        aria-label={t('composer.queuedCount', { count })}
        data-size="xs"
      >
        {queue.steering.map((text, index) => (
          <Item key={`steer-${index}`} size="xs" className="composer-queue-row py-1" asChild>
            <li>
              <ItemMedia className="composer-queue-lead">
                <LoaderCircle className="animate-spin" aria-hidden />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="composer-queue-text" title={text}>
                  {text}
                </ItemTitle>
              </ItemContent>
              <ItemActions>
                <span className="composer-queue-sending">{t('composer.sending')}</span>
              </ItemActions>
            </li>
          </Item>
        ))}
        {shown.map((index) => {
          const text = queue.followUp[index];
          if (text === undefined) return null;
          return (
            <QueuedRow
              key={index}
              index={index}
              text={text}
              disabled={disabled}
              movable={shown.length > 1}
              onDrop={() => void commit(shown)}
              onEdit={() => void edit(index)}
              onSendNow={() => void sendNow(index)}
              onRemove={() => void remove(index)}
            />
          );
        })}
      </Reorder.Group>
    </MotionConfig>
  );
}

const SETTLE = { duration: 0.15, ease: 'easeOut' } as const;

/**
 * One follow-up: the grip, the text, and its actions. Only the grip starts a drag, so the text
 * and buttons keep ordinary pointer behavior.
 */
function QueuedRow({
  index,
  text,
  disabled,
  movable,
  onDrop,
  onEdit,
  onSendNow,
  onRemove,
}: {
  index: number;
  text: string;
  disabled: boolean;
  movable: boolean;
  onDrop: () => void;
  onEdit: () => void;
  onSendNow: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('panel');
  const controls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const locked = disabled || !movable;
  return (
    <Item size="xs" className="composer-queue-row py-1" data-dragging={dragging} asChild>
      <Reorder.Item
        value={index}
        dragListener={false}
        dragControls={controls}
        // Siblings make way and the dropped row settles with a short ease, not the default
        // spring whose overshoot trails the pointer.
        transition={SETTLE}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => {
          setDragging(false);
          onDrop();
        }}
      >
        <ItemMedia className="composer-queue-lead">
          <IconButton
            label={t('composer.reorderQueued')}
            tooltip={false}
            size="icon-xs"
            className="composer-queue-handle"
            disabled={locked}
            onPointerDown={(event) => {
              if (!locked) controls.start(event);
            }}
          >
            <GripVertical />
          </IconButton>
        </ItemMedia>
        <ItemContent>
          <ItemTitle className="composer-queue-text" title={text}>
            {text}
          </ItemTitle>
        </ItemContent>
        <ItemActions className="composer-queue-actions">
          <IconButton
            label={t('composer.editQueued')}
            size="icon-xs"
            tooltipSide="top"
            disabled={disabled}
            onClick={onEdit}
          >
            <Pencil />
          </IconButton>
          <IconButton
            label={t('composer.sendNow')}
            size="icon-xs"
            tooltipSide="top"
            disabled={disabled}
            onClick={onSendNow}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            label={t('composer.removeQueued')}
            size="icon-xs"
            tooltipSide="top"
            disabled={disabled}
            onClick={onRemove}
          >
            <X />
          </IconButton>
        </ItemActions>
      </Reorder.Item>
    </Item>
  );
}
