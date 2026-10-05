import { useState, type ReactElement } from 'react';
import { BookmarkPlus, Ellipsis } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskAgentDefinition } from '@atd/agent-contracts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { IconButton } from '../../../components/icon-button';
import { SaveTaskAgentDialog } from './save-task-agent-dialog';

/**
 * A task agent's actions at the trailing edge of its drill-in header: Save as my subagent opens
 * the confirmation that shows what will be written. The trigger mirrors the way back on the
 * leading edge, so both glyphs sit on the header's inset.
 */
export function TaskAgentMenu({ definition }: { definition: TaskAgentDefinition }): ReactElement {
  const { t } = useTranslation('tasks');
  const [saveOpen, setSaveOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={t('subagent.more')} className="-mr-1.5" tooltipDismissOnClick>
            <Ellipsis />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem onSelect={() => setSaveOpen(true)}>
            <BookmarkPlus />
            {t('subagent.save.action')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SaveTaskAgentDialog definition={definition} open={saveOpen} onOpenChange={setSaveOpen} />
    </>
  );
}
