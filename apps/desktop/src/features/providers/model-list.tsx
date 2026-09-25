import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ai/ui/components/command';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import type { Connection, ModelReference } from '../../../electron/providers/schema';
import { IconButton } from '../../components/icon-button';
import { rankModels } from './model-match';
import { sortModels } from './model-order';
import { useCatalogRefresh } from './use-catalog-refresh';

/**
 * The connections that list a model for the query, each with its models ranked the way the
 * `/model` drill ranks them. Groups follow their best model score, ties in source order, so a
 * blank query keeps every connection that has models in source order.
 */
function rankConnections(connections: readonly Connection[], query: string, scoped: boolean) {
  return connections
    .map((connection, index) => {
      // A scoped list shows no heading, so its connection name must not match unseen.
      const name = scoped ? undefined : connection.name;
      const models = rankModels(sortModels(connection.catalog), query, name);
      const best = models.reduce((top, { match }) => Math.max(top, match?.score ?? 0), 0);
      return { connection, models, index, best };
    })
    .filter((group) => group.models.length > 0)
    .sort((a, b) => b.best - a.best || a.index - b.index);
}

/**
 * The searchable model list of the model picker and the model popover's model view. It ranks
 * and marks only what the list shows (model names and ids, connection headings), so cmdk's own
 * filter stays off: it also matched the hidden connection id in each item value.
 */
export function ModelList({
  connections,
  value,
  searchLabel,
  scoped = false,
  onSelect,
  onOpenProviders,
}: {
  connections: Connection[];
  value: ModelReference | null;
  searchLabel: string;
  /**
   * One connection's own list, as in its settings row: no heading or name prefix, and its
   * models stay choosable while it is disconnected.
   */
  scoped?: boolean;
  onSelect: (value: ModelReference) => void;
  onOpenProviders?: () => void;
}) {
  const { t } = useTranslation('providers');
  const [query, setQuery] = useState('');
  // Popover content mounts only while shown, so mounting is opening the list.
  useCatalogRefresh(true);
  return (
    <Command shouldFilter={false} className="bg-transparent min-h-0">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={t('models.searchPlaceholder')}
        aria-label={searchLabel}
        action={
          onOpenProviders && (
            <IconButton label={t('models.manageProviders')} onClick={onOpenProviders}>
              <Settings2 />
            </IconButton>
          )
        }
      />
      <CommandList className="min-h-0 flex-1 max-h-none">
        {connections
          .filter((connection) => connection.catalogError)
          .map((connection) => (
            <output key={connection.connectionId} className="model-catalog-warning">
              {scoped ? connection.catalogError : `${connection.name}: ${connection.catalogError}`}
            </output>
          ))}
        <CommandEmpty>
          {connections.some((connection) => connection.catalog.length)
            ? t('models.noMatch')
            : t('models.none')}
        </CommandEmpty>
        {rankConnections(connections, query, scoped).map(({ connection, models }) => (
          <CommandGroup
            key={connection.connectionId}
            heading={
              // Every model matches the connection name alike, so the heading shows that match once.
              scoped ? undefined : (
                <HighlightedText
                  text={connection.name}
                  ranges={models[0]?.match?.ranges.connection}
                />
              )
            }
            title={connection.name}
          >
            {models.map(({ item: model, match }) => (
              <CommandItem
                key={model.id}
                // Only identifies the row; ids may contain spaces, so encode the pair.
                value={JSON.stringify([connection.connectionId, model.id])}
                disabled={!scoped && !connection.connected}
                data-checked={
                  value?.connectionId === connection.connectionId && value.modelId === model.id
                }
                onSelect={() =>
                  onSelect({ connectionId: connection.connectionId, modelId: model.id })
                }
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate" title={model.name}>
                    <HighlightedText text={model.name} ranges={match?.ranges.name} />
                  </p>
                  {model.name !== model.id && (
                    <p className="text-xs text-muted-foreground truncate" title={model.id}>
                      <HighlightedText text={model.id} ranges={match?.ranges.id} />
                    </p>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
