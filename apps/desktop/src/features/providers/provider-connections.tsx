import { Check, Ellipsis, RefreshCw, Settings2, Unplug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@ai/ui/components/item';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@ai/ui/components/dropdown-menu';
import type { Connection } from '../../../electron/providers/schema';
import { IconButton } from '../../components/icon-button';
import { ModelPicker } from './model-picker';
import { ProviderBrand } from './provider-brand';

export function ProviderConnections({
  connections,
  defaultConnectionId,
  pending,
  onManage,
  onDisconnect,
  perform,
}: {
  connections: Connection[];
  defaultConnectionId: string | null;
  pending: boolean;
  onManage: (connection: Connection) => void;
  onDisconnect: (connection: Connection) => void;
  perform: (operation: () => Promise<void>, success?: string) => Promise<void>;
}) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  return (
    <ItemGroup className="provider-connections">
      {connections.map((connection) => {
        const isDefault = defaultConnectionId === connection.connectionId;
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
            className="provider-connection-row"
          >
            <li>
              <div className="provider-identity">
                <ProviderBrand provider={connection.provider} />
                <ItemContent>
                  <div className="provider-name-track">
                    <ItemTitle className="min-w-0" title={connection.name}>
                      {connection.name}
                    </ItemTitle>
                    {isDefault && (
                      <span className="provider-default-badge">
                        {t('connections.defaultBadge')}
                      </span>
                    )}
                  </div>
                  <ItemDescription title={description}>{description}</ItemDescription>
                </ItemContent>
              </div>
              <div className="provider-model-controls">
                <ModelPicker
                  scoped
                  connections={[connection]}
                  value={
                    connection.defaultModel
                      ? {
                          connectionId: connection.connectionId,
                          modelId: connection.defaultModel,
                        }
                      : null
                  }
                  label={t('connections.defaultModelLabel', { name: connection.name })}
                  disabled={pending}
                  onChange={(reference) =>
                    void perform(
                      () => bridge!.setModel(reference, connection.revision),
                      t('connections.defaultModelSaved', { name: connection.name }),
                    )
                  }
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
                        void perform(
                          () => bridge!.setDefault(connection.connectionId, connection.revision),
                          t('connections.madeDefault', { name: connection.name }),
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
                    <DropdownMenuItem onSelect={() => onManage(connection)}>
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
                    <DropdownMenuItem
                      disabled={!connection.connected}
                      onSelect={() => onDisconnect(connection)}
                    >
                      <Unplug />
                      {t('connections.disconnect')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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
