import { useState, type ReactElement } from 'react';
import { Copy, Ellipsis, FoldVertical, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import type { TaskDetail } from '../../client/agent/bridge';
import { IconButton } from '../../components/icon-button';
import { compactBlock } from './compaction/compact-availability';
import { useCompactTask } from './compaction/use-compact-task';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskId } from './use-copy-task-id';

export function SessionMenu({ detail }: { detail: TaskDetail }): ReactElement {
  const { t } = useTranslation('panel');
  const [renameOpen, setRenameOpen] = useState(false);
  const copyId = useCopyTaskId();
  const { compact, pending } = useCompactTask();
  const task = detail.task;
  // A blocked item stays listed with its reason, like the matching quick command.
  const blocked = compactBlock(task, detail.context);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('session.menu')}
            aria-label={t('session.menu')}
            variant="glass-ghost"
            className="header-button"
            tooltipDismissOnClick
          >
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="center">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil />
            {t('session.rename')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void copyId(task)}>
            <Copy />
            {t('session.copyId')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={blocked !== null || pending}
            title={blocked ? t(`quickPanel.blocked.${blocked}`) : undefined}
            onSelect={() => void compact(task.id)}
          >
            <FoldVertical />
            {t('session.compact')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameTaskDialog task={task} open={renameOpen} onOpenChange={setRenameOpen} />
    </>
  );
}
