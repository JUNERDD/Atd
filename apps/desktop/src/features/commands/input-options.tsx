import { Label } from '@ai/ui/components/label';
import { Button } from '@ai/ui/components/button';
import { ChevronDown } from 'lucide-react';
import { Switch } from '@ai/ui/components/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { CommandDefinition } from '../../../electron/agent/command-schema';
import { ShortcutInput } from './shortcut-input';

export function InputOptions({
  command,
  onChange,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
}) {
  function source(value: string) {
    if (value !== 'manual' && value !== 'selection' && value !== 'clipboard' && value !== 'none')
      return;
    onChange({
      ...command,
      input: {
        ...command.input,
        source: value,
        required: value === 'none' ? false : command.input.required,
        selection: command.input.selection || value === 'selection',
        clipboard: command.input.clipboard || value === 'clipboard',
      },
    });
  }
  return (
    <div className="space-y-4">
      <div className="field-columns aligned-fields">
        <div className="settings-field">
          <Label htmlFor="command-source">Input source</Label>
          <Select value={command.input.source} onValueChange={source}>
            <SelectTrigger id="command-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Manual input</SelectItem>
              <SelectItem value="selection">Selected text</SelectItem>
              <SelectItem value="clipboard">Clipboard</SelectItem>
              <SelectItem value="none">No text input</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="settings-field">
          <Label htmlFor="command-shortcut">Shortcut</Label>
          <ShortcutInput
            value={command.shortcut}
            onChange={(shortcut) => onChange({ ...command, shortcut })}
          />
        </div>
      </div>
      <details className="input-options group/input-options">
        <Button
          asChild
          variant="ghost"
          size="xs"
          className="cursor-pointer text-muted-foreground group-open/input-options:bg-muted dark:group-open/input-options:bg-input dark:group-open/input-options:hover:bg-input"
        >
          <summary>
            Input options
            <ChevronDown className="group-open/input-options:rotate-180" />
          </summary>
        </Button>
        <div className="space-y-3 pt-3">
          {(
            [
              ['required', 'Require text input'],
              ['files', 'Allow attached files'],
              ['selection', 'Selected text variable'],
              ['clipboard', 'Clipboard variable'],
            ] as const
          ).map(([key, label]) => (
            <div className="flex items-center justify-between gap-4" key={key}>
              <Label htmlFor={`input-${key}`}>{label}</Label>
              <Switch
                id={`input-${key}`}
                disabled={
                  (key === 'required' && command.input.source === 'none') ||
                  (key === 'selection' && command.input.source === 'selection') ||
                  (key === 'clipboard' && command.input.source === 'clipboard')
                }
                checked={command.input[key]}
                onCheckedChange={(checked) =>
                  onChange({ ...command, input: { ...command.input, [key]: checked } })
                }
              />
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
