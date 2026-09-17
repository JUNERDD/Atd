import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('commands');
  const available = availableVariables(command);
  const row = (name: string, detail: string, source?: ContextVariable) => {
    const enabled = available.includes(name);
    const disabledHint = enabled ? '' : ` · ${t('variables.enableFirst')}`;
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
            title={`${detail}${disabledHint}`}
          >
            {detail}
            {disabledHint}
          </span>
        </span>
        <IconButton
          size="icon"
          label={enabled ? t('variables.insert') : t('variables.configure')}
          aria-label={
            enabled
              ? t('variables.insertFor', { name: `{{${name}}}` })
              : t('variables.configureFor', { name })
          }
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
        <h3 className="text-lg font-medium">{t('variables.insert')}</h3>
        <Button variant="ghost" onClick={onDone}>
          {t('variables.done')}
        </Button>
      </div>
      <CommandInput placeholder={t('variables.search')} />
      <CommandList className="min-h-0 max-h-[min(400px,55vh)]">
        <CommandEmpty>{t('variables.empty')}</CommandEmpty>
        <CommandGroup heading={t('variables.builtIn')}>
          {contextVariables.map(({ name, detailKey }) => row(name, t(detailKey), name))}
        </CommandGroup>
        <CommandGroup
          heading={
            command.parameters.length ? t('variables.yourParameters') : t('variables.noParameters')
          }
        >
          {parameterVariables(command, t).map(({ name, detail }) => row(name, detail))}
          <CommandItem onSelect={onAddParameter}>
            <Plus />
            {t('parameters.add')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <p className="shrink-0 px-2 py-1.5 text-xs text-muted-foreground">
        {t('variables.footerHint')}
      </p>
    </Command>
  );
}
