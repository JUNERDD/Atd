import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
  const [open, setOpen] = useState(false);
  const connection = connections.find((item) => item.connectionId === value?.connectionId);
  const name =
    connection?.catalog.find((model) => model.id === value?.modelId)?.name ??
    (value?.modelId || 'Choose model');
  const unavailable = Boolean(
    value?.modelId &&
    (!connection?.connected || !connection.catalog.some((model) => model.id === value.modelId)),
  );
  const displayName = unavailable ? `${name} · Unavailable` : name;
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
            placeholder="Search models…"
            aria-label={scoped ? `${label}: search models` : 'Search models'}
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
                ? 'No matching models'
                : 'No models available'}
            </CommandEmpty>
            {connections.map((item) => (
              <CommandGroup
                key={item.connectionId}
                heading={scoped ? undefined : item.name}
                title={item.name}
              >
                {item.catalog.map((model) => (
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
          {onOpenProviders && (
            <div className="shrink-0 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => {
                  setOpen(false);
                  onOpenProviders();
                }}
              >
                Manage providers
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
