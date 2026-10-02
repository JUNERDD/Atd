import { useState, type ReactElement } from 'react';
import { Copy, Ellipsis, Folder, FoldVertical, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import type { TaskDetail } from '../../client/agent/bridge';
import { IconButton } from '../../components/icon-button';
import { compactBlock } from './compaction/compact-availability';
import { useCompactTask } from './compaction/use-compact-task';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskId } from './use-copy-task-id';
import { useTaskFolders } from './use-task-folders';

/**
 * The session's actions: rename, copy its id, compact its context, and the folders it may read,
 * each of which a click revokes for later runs (the running one keeps reading). The folder group
 * shows only while the task has folders, labeled in place like the other grouped menus.
 */
export function SessionMenu({ detail }: { detail: TaskDetail }): ReactElement {
  const { t } = useTranslation('panel');
  const [renameOpen, setRenameOpen] = useState(false);
  const copyId = useCopyTaskId();
  const { compact, pending } = useCompactTask();
  const task = detail.task;
  const { folders, revoke, revoking } = useTaskFolders(task.id);
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
          {folders.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t('session.folders.title')}</DropdownMenuLabel>
                {folders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    disabled={revoking}
                    title={t('session.folders.revokeHint', { path: folder.path })}
                    aria-label={t('session.folders.revoke', { name: folder.name })}
                    onSelect={() => revoke(folder)}
                  >
                    <Folder />
                    <span className="max-w-64 min-w-0 flex-1 truncate">{folder.name}</span>
                    <X className="text-muted-foreground" />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameTaskDialog task={task} open={renameOpen} onOpenChange={setRenameOpen} />
    </>
  );
}
