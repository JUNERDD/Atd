import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@ai/ui/components/popover';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import { ModelList } from './model-list';
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
        <ModelList
          connections={connections}
          value={value}
          scoped={scoped}
          searchLabel={scoped ? t('models.searchScopedLabel', { label }) : t('models.searchLabel')}
          onSelect={(reference) => {
            onChange(reference);
            setOpen(false);
          }}
          onOpenProviders={
            onOpenProviders &&
            (() => {
              setOpen(false);
              onOpenProviders();
            })
          }
        />
      </PopoverContent>
    </Popover>
  );
}
