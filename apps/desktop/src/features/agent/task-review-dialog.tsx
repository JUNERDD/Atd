import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@ai/ui/components/dialog';
import type { TaskRun } from '../../../electron/agent/task-schema';
import { agentApi } from './use-agent';
import { showErrorToast, showToast } from '../../components/toast-store';
import { copyCommand } from '../../../electron/agent/command-templates';

export function TaskReviewDialog({
  open,
  onOpenChange,
  runs,
  onRerun,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runs: TaskRun[];
  onRerun: (run: TaskRun) => void;
}) {
  const { t } = useTranslation('tasks');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel-dialog">
        <DialogHeader>
          <DialogTitle>{t('review.title')}</DialogTitle>
          <DialogDescription>{t('review.description')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="flex-1 min-h-0 m-[-4px_-16px_-4px_-4px]" gutter>
          <div className="panel-dialog-body">
            {runs.map((item) => (
              <section key={item.id} className="space-y-2 border-b border-border pb-4">
                <p
                  className="truncate text-sm font-medium"
                  title={`${item.snapshot.command?.name ?? t('review.conversation')} · ${t(`status.${item.status}`)}${item.snapshot.command ? ` · ${t('review.version', { revision: item.snapshot.command.revision })}` : ''}`}
                >
                  {item.snapshot.command?.name ?? t('review.conversation')} ·{' '}
                  {t(`status.${item.status}`)}
                  {item.snapshot.command &&
                    ` · ${t('review.version', { revision: item.snapshot.command.revision })}`}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={`${item.snapshot.model.modelId} · ${item.snapshot.memory ? t('review.memoryOn') : t('review.memoryOff')} · ${item.snapshot.tools.join(', ')}`}
                >
                  {item.snapshot.model.modelId} ·{' '}
                  {item.snapshot.memory ? t('review.memoryOn') : t('review.memoryOff')} ·{' '}
                  {item.snapshot.tools.join(', ')}
                </p>
                <ScrollArea className="review-text" viewportClassName="max-h-[inherit]">
                  <pre>{item.snapshot.input.text}</pre>
                </ScrollArea>
                {item.snapshot.instructions && (
                  <details>
                    <summary className="text-sm cursor-pointer">
                      {t('review.savedInstructions')}
                    </summary>
                    <ScrollArea className="review-text" viewportClassName="max-h-[inherit]">
                      <pre>{item.snapshot.instructions}</pre>
                    </ScrollArea>
                  </details>
                )}
                <Button
                  variant="outline"
                  className="task-review-action"
                  onClick={() => {
                    onOpenChange(false);
                    onRerun(item);
                  }}
                >
                  {t('review.useSavedVersion')}
                </Button>
                {item.snapshot.command && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (item.snapshot.command)
                        void agentApi()
                          .saveCommand(copyCommand(item.snapshot.command, crypto.randomUUID()), 0)
                          .then(() => showToast({ kind: 'info', text: t('review.commandCopied') }))
                          .catch((error) => showErrorToast(error));
                    }}
                  >
                    {t('review.saveAsCommand')}
                  </Button>
                )}
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
