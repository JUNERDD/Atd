import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import { ChevronDown } from 'lucide-react';
import { Label } from '@atd/ui/components/label';
import { Switch } from '@atd/ui/components/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@atd/ui/components/popover';
import type { CommandDefinition } from '../../client/agent/command-schema';

type CommandInput = CommandDefinition['input'];

const SWITCHES = [
  ['required', 'input.requireText'],
  ['files', 'input.allowFiles'],
  ['selection', 'input.selectionVariable'],
  ['clipboard', 'input.clipboardVariable'],
] as const;

/**
 * The Input options popover: whether a run needs text and what else it may attach. The flag the
 * input source fills stays on and locked (a screenshot is an attached file), and a command without
 * text input cannot require it. The editor opens it from an instruction variable that needs a
 * source (`open`), then focuses the switch by its `input-<flag>` id.
 */
export function InputOptions({
  input,
  onChange,
  open,
  onOpenChange,
}: {
  input: CommandInput;
  onChange: (input: CommandInput) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation('commands');
  const [internalOpen, setInternalOpen] = useState(false);
  return (
    <Popover open={open ?? internalOpen} onOpenChange={onOpenChange ?? setInternalOpen}>
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
          {SWITCHES.map(([key, labelKey]) => (
            <div className="flex items-center justify-between gap-4" key={key}>
              <Label htmlFor={`input-${key}`}>{t(labelKey)}</Label>
              <Switch
                id={`input-${key}`}
                disabled={
                  (key === 'required' && input.source === 'none') ||
                  (key === 'files' && input.source === 'screenshot') ||
                  (key === 'selection' && input.source === 'selection') ||
                  (key === 'clipboard' && input.source === 'clipboard')
                }
                checked={input[key]}
                onCheckedChange={(checked) => onChange({ ...input, [key]: checked })}
              />
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
