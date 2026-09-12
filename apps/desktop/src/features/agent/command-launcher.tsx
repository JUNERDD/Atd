import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@ai/ui/components/command';
import { Button } from '@ai/ui/components/button';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Languages, ListTodo, Terminal } from 'lucide-react';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { shortcutKeys } from '../../lib/shortcuts';

export function CommandLauncher({
  commands,
  onChoose,
  compact = false,
  onAll,
}: {
  commands: CommandDefinition[];
  onChoose: (id: string) => void;
  compact?: boolean;
  onAll?: () => void;
}) {
  const available = commands.filter((command) => command.enabled);
  if (compact)
    return (
      <div className="quick-commands">
        {available.slice(0, 2).map((command) => (
          <Button
            key={command.id}
            variant="ghost"
            className="quick-command"
            onClick={() => onChoose(command.id)}
          >
            {command.templateId === 'translate' ? (
              <Languages />
            ) : command.templateId === 'extract' ? (
              <ListTodo />
            ) : (
              <Terminal />
            )}
            <span className="quick-command-copy">
              <span>{command.name}</span>
              <small>{command.description}</small>
            </span>
            {command.shortcut && (
              <KbdGroup>
                {shortcutKeys(command.shortcut, window.desktop?.platform ?? 'web').map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            )}
          </Button>
        ))}
        <Button variant="outline" className="self-start" onClick={onAll}>
          All commands
        </Button>
      </div>
    );
  return (
    <section className="panel-content command-catalog">
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList className="max-h-none">
          <CommandEmpty>No matching commands.</CommandEmpty>
          {available.map((command) => (
            <CommandItem
              key={command.id}
              value={`${command.name} ${command.description}`}
              onSelect={() => onChoose(command.id)}
              className="command-option dark:data-selected:bg-(--ata-surface-ghost-hover)"
            >
              <Terminal />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{command.name}</span>
                <span className="block text-xs text-muted-foreground">{command.description}</span>
              </span>
              <CommandShortcut>
                {command.shortcut
                  ? shortcutKeys(command.shortcut, window.desktop?.platform ?? 'web').join(' ')
                  : ''}
              </CommandShortcut>
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </section>
  );
}
