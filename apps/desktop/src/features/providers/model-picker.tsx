import { useState } from 'react';
import { ChevronDown, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ai/ui/components/command';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import { IconButton } from '../../components/icon-button';
import { sortModels } from './model-order';
import { ProviderBrand } from './provider-brand';

export function ModelPicker({
  connections,
  value,
  onChange,
  label,
  scoped = false,
  compact = false,
  disabled = false,
  onOpenProviders,
}: {
  connections: Connection[];
  value: ModelReference | null;
  onChange: (value: ModelReference) => void;
  label: string;
  scoped?: boolean;
  compact?: boolean;
  disabled?: boolean;
  onOpenProviders?: () => void;
}) {
  const { t } = useTranslation('providers');
  const [open, setOpen] = useState(false);
  const connection = connections.find((item) => item.connectionId === value?.connectionId);
  const name =
    connection?.catalog.find((model) => model.id === value?.modelId)?.name ??
    (value?.modelId || t('models.choose'));
  const unavailable = Boolean(
    value?.modelId &&
    (!connection?.connected || !connection.catalog.some((model) => model.id === value.modelId)),
  );
  const displayName = unavailable ? t('models.unavailable', { name }) : name;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? 'xs' : 'default'}
          className={compact ? 'composer-model' : 'provider-model-trigger'}
          disabled={disabled}
          aria-label={label}
          title={connection && !scoped ? `${connection.name} · ${displayName}` : displayName}
        >
          {!scoped && connection && <ProviderBrand provider={connection.provider} />}
          <span className="min-w-0 flex-1 truncate text-left">{displayName}</span>
          <ChevronDown className="shrink-0 size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className={`model-picker p-0 ${scoped ? 'model-picker-scoped' : ''}`}
        align="end"
        collisionPadding={8}
      >
        <Command className="bg-transparent min-h-0">
          <CommandInput
            placeholder={t('models.searchPlaceholder')}
            aria-label={scoped ? t('models.searchScopedLabel', { label }) : t('models.searchLabel')}
            action={
              onOpenProviders && (
                <IconButton
                  label={t('models.manageProviders')}
                  onClick={() => {
                    setOpen(false);
                    onOpenProviders();
                  }}
                >
                  <Settings2 />
                </IconButton>
              )
            }
          />
          <CommandList className="min-h-0 flex-1 max-h-none">
            {connections
              .filter((item) => item.catalogError)
              .map((item) => (
                <output key={item.connectionId} className="model-catalog-warning">
                  {!scoped && `${item.name}: `}
                  {item.catalogError}
                </output>
              ))}
            <CommandEmpty>
              {connections.some((item) => item.catalog.length)
                ? t('models.noMatch')
                : t('models.none')}
            </CommandEmpty>
            {connections.map((item) => (
              <CommandGroup
                key={item.connectionId}
                heading={scoped ? undefined : item.name}
                title={item.name}
              >
                {sortModels(item.catalog).map((model) => (
                  <CommandItem
                    key={model.id}
                    value={`${item.connectionId} ${model.id}`}
                    keywords={[item.name, model.name]}
                    disabled={!scoped && !item.connected}
                    data-checked={
                      value?.connectionId === item.connectionId && value.modelId === model.id
                    }
                    onSelect={() => {
                      onChange({ connectionId: item.connectionId, modelId: model.id });
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate" title={model.name}>
                        {model.name}
                      </p>
                      {model.name !== model.id && (
                        <p className="text-xs text-muted-foreground truncate" title={model.id}>
                          {model.id}
                        </p>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
