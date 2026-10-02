import { BookOpen, Bot, Brain, Command, PackagePlus, Plug, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';

/** What Create makes in Personal; commands open the Commands section's own editor. */
export type PersonalCreateKind = 'skill' | 'agent' | 'mcp' | 'command' | 'memory';

/**
 * The Extensions heading's Add menu: Install plugin (a folder, Git repository or npm package), then
 * the Create group, which makes things in Personal: a skill (Create with AI), a subagent or MCP
 * server (their forms, which also offer Create with AI), a command (the Commands section), or a
 * memory (Create with AI, as the Memory section offers). The group is labeled in place rather than
 * nested, so every choice stays one step away at any window width.
 */
export function ExtensionAddMenu({
  disabled,
  onInstall,
  onCreate,
}: {
  disabled: boolean;
  onInstall: () => void;
  onCreate: (kind: PersonalCreateKind) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" disabled={disabled}>
          <Plus data-icon="inline-start" />
          {t('extensions.plugins.add')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onInstall}>
          <PackagePlus />
          {t('extensions.plugins.installPlugin')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('extensions.plugins.createGroup')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onCreate('skill')}>
            <BookOpen />
            {t('extensions.plugins.create.skill')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate('agent')}>
            <Bot />
            {t('extensions.plugins.create.agent')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate('mcp')}>
            <Plug />
            {t('extensions.plugins.create.mcp')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate('command')}>
            <Command />
            {t('extensions.plugins.create.command')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCreate('memory')}>
            <Brain />
            {t('extensions.plugins.create.memory')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
