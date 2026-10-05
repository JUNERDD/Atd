import { DropdownMenuItem } from '@atd/ui/components/dropdown-menu';
import type { CommandDefinition } from '../../../client/agent/command-schema';
import { CommandIcon } from '../../commands/command-icon';

/**
 * One menu row per offered command (`useOfferedCommands`): its icon and its name. A long name is
 * truncated on screen only: the row's text, and so its accessible name, stays whole, and hovering
 * the name shows all of it.
 */
export function CommandMenuItems({
  commands,
  onRun,
}: {
  commands: CommandDefinition[];
  onRun: (command: CommandDefinition) => void;
}) {
  return commands.map((command) => (
    <DropdownMenuItem key={command.id} onSelect={() => onRun(command)}>
      <CommandIcon templateId={command.templateId} />
      <span className="max-w-64 min-w-0 flex-1 truncate" title={command.name}>
        {command.name}
      </span>
    </DropdownMenuItem>
  ));
}
