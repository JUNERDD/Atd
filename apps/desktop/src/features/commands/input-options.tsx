import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@ai/ui/components/label';
import { Button } from '@ai/ui/components/button';
import { ChevronDown } from 'lucide-react';
import { Switch } from '@ai/ui/components/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ai/ui/components/select';
import type { CommandDefinition } from '../../client/agent/command-schema';
import { ShortcutConflictHint } from '../settings/shortcut-conflict-hint';
import { FieldError } from './field-error';
import { ShortcutInput } from './shortcut-input';
import { errorId } from './use-command-problems';

export function InputOptions({
  command,
  onChange,
  open,
  onOpenChange,
  error,
  onBlur,
}: {
  command: CommandDefinition;
  onChange: (command: CommandDefinition) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The input settings' problem in the app's language, or '' when there is none. */
  error: string;
  /** Focus left the input settings (the options popover included). */
  onBlur: () => void;
}) {
  const { t } = useTranslation('commands');
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const setIsOpen = onOpenChange ?? setInternalOpen;
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
    <div className="space-y-4" onBlur={onBlur}>
      <div className="flex flex-col gap-2">
        <div className="field-columns aligned-fields">
          <div className="settings-field">
            <Label htmlFor="command-source">{t('input.source')}</Label>
            <Select value={command.input.source} onValueChange={source}>
              <SelectTrigger
                id="command-source"
                className="w-full"
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? errorId('input') : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">{t('input.sourceManual')}</SelectItem>
                <SelectItem value="selection">{t('input.sourceSelection')}</SelectItem>
                <SelectItem value="clipboard">{t('input.sourceClipboard')}</SelectItem>
                <SelectItem value="none">{t('input.sourceNone')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="settings-field input-shortcut-field">
            <Label htmlFor="command-shortcut">{t('input.shortcut')}</Label>
            <ShortcutInput
              value={command.shortcut}
              onChange={(shortcut) => onChange({ ...command, shortcut })}
            />
          </div>
        </div>
        {error && <FieldError id={errorId('input')}>{error}</FieldError>}
        {/* Command shortcuts are global, and the shortcut column is too narrow for a note. */}
        <ShortcutConflictHint />
      </div>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs">
            {t('input.options')}
            <ChevronDown />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="input-options-popover rounded-2xl"
          align="start"
          collisionPadding={8}
        >
          <div className="space-y-3">
            {(
              [
                ['required', 'input.requireText'],
                ['files', 'input.allowFiles'],
                ['selection', 'input.selectionVariable'],
                ['clipboard', 'input.clipboardVariable'],
              ] as const
            ).map(([key, labelKey]) => (
              <div className="flex items-center justify-between gap-4" key={key}>
                <Label htmlFor={`input-${key}`}>{t(labelKey)}</Label>
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
