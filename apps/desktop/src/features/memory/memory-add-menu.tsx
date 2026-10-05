import { BookmarkPlus, Plus, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import { useMemoryCreate } from './use-memory-create';

/**
 * The Memory heading's Add menu, like the Extensions heading's: New memory opens an empty memory
 * page, and Create with AI opens a panel session seeded with the `create-memory` skill
 * (`useMemoryCreate`). The agent cannot save memories while learning is paused, so then Create
 * with AI says so in a toast instead of opening a session that cannot save.
 */
export function MemoryAddMenu({
  paused,
  unavailable,
  onNew,
}: {
  /** Automatic learning is paused, so the agent cannot write memories. */
  paused: boolean;
  /** Memory has not loaded, or failed to. */
  unavailable: boolean;
  onNew: () => void;
}) {
  const { t } = useTranslation('memory');
  const { starting, start } = useMemoryCreate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" disabled={unavailable}>
          <Plus data-icon="inline-start" />
          {t('memory.add.label')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onNew}>
          <BookmarkPlus />
          {t('memory.add.new')}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={starting} onSelect={() => start(paused)}>
          <Sparkles />
          {t('memory.add.createWithAi')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
