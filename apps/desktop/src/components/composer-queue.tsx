import { Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from '@ai/ui/components/item';
import type { QueueState } from '../../electron/agent/transcript-schema';
import { IconButton } from './icon-button';
import { agentApi } from '../features/agent/use-agent';
import { showErrorToast } from './toast-store';

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
  const count = queue.steering.length + queue.followUp.length;
  if (count === 0) return null;
  async function replaceFollowUp(followUp: string[]) {
    await agentApi().replaceQueue(taskId, followUp);
  }
  async function edit(index: number) {
    const text = queue.followUp[index];
    if (text === undefined) return;
    try {
      await replaceFollowUp(queue.followUp.filter((_, item) => item !== index));
      onEdit(text);
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function sendNow(index: number) {
    const text = queue.followUp[index];
    if (text === undefined) return;
    try {
      await replaceFollowUp(queue.followUp.filter((_, item) => item !== index));
      await agentApi().queueMessage(taskId, text, 'steer');
    } catch (error) {
      showErrorToast(error);
    }
  }
  async function remove(index: number) {
    try {
      await replaceFollowUp(queue.followUp.filter((_, item) => item !== index));
    } catch (error) {
      showErrorToast(error);
    }
  }
  return (
    <ItemGroup
      className="composer-queue"
      aria-label={t('composer.queuedCount', { count })}
      data-size="xs"
    >
      {queue.steering.map((text, index) => (
        <Item key={`steer-${index}`} size="xs" asChild>
          <li>
            <ItemContent>
              <ItemTitle>{text}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <span className="composer-queue-sending">{t('composer.sending')}</span>
            </ItemActions>
          </li>
        </Item>
      ))}
      {queue.followUp.map((text, index) => (
        <Item key={`follow-${index}`} size="xs" asChild>
          <li>
            <ItemContent>
              <ItemTitle>{text}</ItemTitle>
            </ItemContent>
            <ItemActions className="composer-queue-actions">
              <IconButton
                label={t('composer.editQueued')}
                size="icon-xs"
                tooltipSide="top"
                disabled={disabled}
                onClick={() => void edit(index)}
              >
                <Pencil />
              </IconButton>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={() => void sendNow(index)}
              >
                {t('composer.sendNow')}
              </Button>
              <IconButton
                label={t('composer.removeQueued')}
                size="icon-xs"
                tooltipSide="top"
                disabled={disabled}
                onClick={() => void remove(index)}
              >
                <X />
              </IconButton>
            </ItemActions>
          </li>
        </Item>
      ))}
    </ItemGroup>
  );
}
