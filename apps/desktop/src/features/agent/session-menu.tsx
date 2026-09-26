import { useState, type ReactElement } from 'react';
import { Link2, Pencil, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { IconButton } from '../../components/icon-button';
import { RenameTaskDialog } from './rename-task-dialog';
import { useCopyTaskLink } from './use-copy-task-link';

export function SessionMenu({ task }: { task: AgentTask }): ReactElement {
  const { t } = useTranslation('panel');
  const [renameOpen, setRenameOpen] = useState(false);
  const copyLink = useCopyTaskLink();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('session.menu')}
            aria-label={t('session.menu')}
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
          <DropdownMenuItem onSelect={() => void copyLink(task)}>
            <Link2 />
            {t('session.copyLink')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RenameTaskDialog task={task} open={renameOpen} onOpenChange={setRenameOpen} />
    </>
  );
}
