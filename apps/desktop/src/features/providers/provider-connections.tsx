import { Check, Ellipsis, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HighlightedText } from '@ai/ui/components/highlighted-text';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@ai/ui/components/item';
import type { MatchRange } from '@ai/ui/lib/fuzzy-match';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import type { Connection } from '../../client/providers/schema';
import { IconButton } from '../../components/icon-button';
import { ModelConfigPopover } from './model-config-popover';
import { ProviderBrand } from './provider-brand';

/** One overview row: a connection and where the overview search matched its name. */
interface ConnectionRow {
  connection: Connection;
  nameRanges?: readonly MatchRange[] | undefined;
}

/**
 * The connections on the Providers overview. A click anywhere on a row manages the connection,
 * like the other settings lists; the default model and More stay interactive above it. Changes
 * show in place (the badge, the model, the status line), so none of them adds a toast.
 */
export function ProviderConnections({
  rows,
  defaultConnectionId,
  pending,
  canManage,
  onManage,
  onDisconnect,
  perform,
}: {
  rows: ConnectionRow[];
  defaultConnectionId: string | null;
  pending: boolean;
  /** Whether the provider catalog is loaded, which a connection's page needs. */
  canManage: boolean;
  onManage: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  perform: (operation: () => Promise<void>) => Promise<void>;
}) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  return (
    <ItemGroup className="provider-connections">
      {rows.map(({ connection, nameRanges }) => {
        const isDefault = defaultConnectionId === connection.connectionId;
        const model = connection.defaultModel
          ? { connectionId: connection.connectionId, modelId: connection.defaultModel }
          : null;
        const verified = Boolean(
          connection.verifiedModel && connection.verifiedModel === connection.defaultModel,
        );
        const description = !connection.connected
          ? t('connections.status.disconnected')
          : connection.authType === 'oauth'
            ? t('connections.status.oauth')
            : connection.authType === 'none'
              ? t('connections.status.noKey', { baseUrl: connection.baseUrl })
              : connection.authType === 'ambient'
                ? t('connections.status.ambient')
                : t(
                    verified
                      ? 'connections.status.apiKeyVerified'
                      : 'connections.status.apiKeyUnverified',
                  );
        return (
          <Item
            asChild
            variant="outline"
            key={connection.connectionId}
            className="provider-connection-row settings-open-row"
          >
            <li>
              <button
                type="button"
                className="settings-open-row-button"
                aria-label={t('connections.manageLabel', { name: connection.name })}
                disabled={!canManage}
                onClick={() => onManage(connection)}
              />
              <div className="provider-identity">
                <ProviderBrand provider={connection.provider} />
                <ItemContent>
                  <div className="provider-name-track">
                    <ItemTitle className="min-w-0" title={connection.name}>
                      <HighlightedText text={connection.name} ranges={nameRanges} />
                    </ItemTitle>
                    {isDefault && (
                      <span className="provider-default-badge">
                        {t('connections.defaultBadge')}
                      </span>
                    )}
                  </div>
                  <ItemDescription className="whitespace-normal">{description}</ItemDescription>
                </ItemContent>
              </div>
              <ItemActions className="provider-model-controls">
                <ModelConfigPopover
                  connections={[connection]}
                  model={model}
                  // Runs without a saved level run with reasoning off.
                  thinkingLevel={connection.defaultThinkingLevel ?? 'off'}
                  scopeLabel={t('connections.defaultModelLabel', { name: connection.name })}
                  disabled={pending}
                  onModelChange={(reference) =>
                    void perform(() => bridge!.setModel(reference, connection.revision))
                  }
                  onThinkingLevelChange={(level) => {
                    // The popover offers levels only once a model is chosen.
                    if (!model) return;
                    void perform(() => bridge!.setModel(model, connection.revision, level));
                  }}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      label={t('connections.more')}
                      aria-label={t('connections.actionsLabel', { name: connection.name })}
                      disabled={pending}
                      tooltipDismissOnClick
                    >
                      <Ellipsis />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
                    <DropdownMenuItem
                      disabled={isDefault || !connection.defaultModel || !connection.connected}
                      onSelect={() =>
                        void perform(() =>
                          bridge!.setDefault(connection.connectionId, connection.revision),
                        )
                      }
                    >
                      <Check />
                      <div>
                        {isDefault ? t('connections.currentDefault') : t('connections.makeDefault')}
                        {!connection.defaultModel && (
                          <p className="text-xs text-muted-foreground">
                            {t('connections.chooseDefaultModel')}
                          </p>
                        )}
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled={!canManage} onSelect={() => onManage(connection)}>
                      <Settings2 />
                      {t('connections.manage')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!connection.connected}
                      onSelect={() => void perform(() => bridge!.refresh(connection.connectionId))}
                    >
                      <RefreshCw />
                      {t('connections.refresh')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={!connection.connected}
                      onSelect={() => onDisconnect(connection)}
                    >
                      <Unplug />
                      {t('connections.disconnect')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
              {connection.catalogError && (
                <output className="provider-row-notice">{connection.catalogError}</output>
              )}
              {connection.defaultModel &&
                !connection.catalog.some((model) => model.id === connection.defaultModel) && (
                  <p className="provider-row-notice">
                    {t('connections.unavailableModel', { model: connection.defaultModel })}
                  </p>
                )}
            </li>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
