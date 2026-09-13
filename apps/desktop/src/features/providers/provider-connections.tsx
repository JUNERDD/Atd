import { Check, Ellipsis, RefreshCw, Settings2, Unplug } from 'lucide-react';
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
  const bridge = window.desktop?.settings.providers;
  return (
    <ItemGroup className="provider-connections">
      {connections.map((connection) => {
        const isDefault = defaultConnectionId === connection.connectionId;
        const description = !connection.connected
          ? 'Disconnected · Reconnect to use'
          : connection.authType === 'oauth'
            ? 'Account login · Signed in'
            : connection.authType === 'none'
              ? `No API key · ${connection.baseUrl}`
              : connection.authType === 'ambient'
                ? 'Cloud credentials'
                : `API key saved · ${connection.verifiedModel === connection.defaultModel && connection.verifiedModel ? 'Verified' : 'Not yet verified'}`;
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
                    <ItemTitle className="min-w-0 flex-1 truncate" title={connection.name}>
                      {connection.name}
                    </ItemTitle>
                    {isDefault && <span className="provider-default-badge">Default</span>}
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
                  label={`Default model for ${connection.name}`}
                  disabled={pending}
                  onChange={(reference) =>
                    void perform(
                      () => bridge!.setModel(reference, connection.revision),
                      `Default model saved for ${connection.name}.`,
                    )
                  }
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      label="More"
                      aria-label={`Connection actions for ${connection.name}`}
                      disabled={pending}
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
                          `${connection.name} is now the default provider.`,
                        )
                      }
                    >
                      <Check />
                      <div>
                        {isDefault ? 'Current default' : 'Make default provider'}
                        {!connection.defaultModel && (
                          <p className="text-xs text-muted-foreground">
                            Choose a default model first
                          </p>
                        )}
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onManage(connection)}>
                      <Settings2 />
                      Manage connection
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!connection.connected}
                      onSelect={() => void perform(() => bridge!.refresh(connection.connectionId))}
                    >
                      <RefreshCw />
                      Refresh models
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!connection.connected}
                      onSelect={() => onDisconnect(connection)}
                    >
                      <Unplug />
                      Disconnect
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
                    {connection.defaultModel} is unavailable. Refresh models or choose another
                    model.
                  </p>
                )}
            </li>
          </Item>
        );
      })}
    </ItemGroup>
  );
}
