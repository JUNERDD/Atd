import { Plus, Settings2 } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ai/ui/components/command';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { availableVariables } from '../../../electron/agent/command-validation';
import { IconButton } from '../../components/icon-button';
import { contextVariables, parameterVariables, type ContextVariable } from './command-variables';

export function VariablePicker({
  command,
  onInsert,
  onConfigure,
  onDone,
  onAddParameter,
}: {
  command: CommandDefinition;
  onInsert: (name: string) => void;
  onConfigure: (source: ContextVariable) => void;
  onDone: () => void;
  onAddParameter: () => void;
}) {
  const available = availableVariables(command);
  const row = (name: string, detail: string, source?: ContextVariable) => {
    const enabled = available.includes(name);
    const act = () => {
      if (enabled) onInsert(name);
      else if (source) onConfigure(source);
    };
    return (
      <CommandItem
        key={name}
        value={`${name} ${detail}`}
        className="variable-option"
        onSelect={act}
      >
        <span className="min-w-0 flex-1 flex flex-col gap-0.5">
          <span
            className={
              enabled
                ? 'variable-token truncate font-medium'
                : 'truncate text-muted-foreground font-medium'
            }
            title={`{{${name}}}`}
          >{`{{${name}}}`}</span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={`${detail}${!enabled ? ' · enable this source first' : ''}`}
          >
            {detail}
            {!enabled ? ' · enable this source first' : ''}
          </span>
        </span>
        <IconButton
          size="icon"
          label={enabled ? 'Insert' : 'Configure'}
          aria-label={enabled ? `Insert {{${name}}}` : `Configure ${name} source`}
          onClick={(event) => {
            event.stopPropagation();
            act();
          }}
        >
          {enabled ? <Plus /> : <Settings2 />}
        </IconButton>
      </CommandItem>
    );
  };
  return (
    <Command className="min-h-0">
      <div className="flex shrink-0 items-center justify-between px-1 pt-1">
        <h3 className="text-lg font-medium">Insert variable</h3>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      <CommandInput placeholder="Search variables…" />
      <CommandList className="min-h-0 max-h-[min(400px,55vh)]">
        <CommandEmpty>No variables found.</CommandEmpty>
        <CommandGroup heading="Built-in context">
          {contextVariables.map(({ name, detail }) => row(name, detail, name))}
        </CommandGroup>
        <CommandGroup
          heading={command.parameters.length ? 'Your parameters' : 'No custom parameters yet'}
        >
          {parameterVariables(command).map(({ name, detail }) => row(name, detail))}
          <CommandItem onSelect={onAddParameter}>
            <Plus />
            Add parameter
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <p className="shrink-0 px-2 py-1.5 text-xs text-muted-foreground">
        ↑ ↓ to choose · Enter to insert · Esc to close
      </p>
    </Command>
  );
}
