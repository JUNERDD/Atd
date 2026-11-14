import { useState } from 'react';
import { Check, CircleAlert, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_MODEL_ALIASES, type ModelAlias } from '@atd/agent-contracts';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atd/ui/components/alert-dialog';
import { Badge } from '@atd/ui/components/badge';
import { Button } from '@atd/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@atd/ui/components/dropdown-menu';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from '@atd/ui/components/item';
import type { Connection } from '../../client/providers/schema';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { IconButton } from '../../components/icon-button';
import { ItemContextMenu, ItemMenuItem, ItemMenuSeparator } from '../../components/item-menu';
import { messageOf } from '../../lib/errors';
import { formatContextWindow } from './context-window';
import { ModelAliasDialog } from './model-alias-dialog';
import { ModelAliasStarters } from './model-alias-starters';
import { ProviderBrand } from './provider-brand';
import { providerPresentation } from './provider-services';
import '../../components/open-row.css';

function aliasDescription(
  alias: ModelAlias,
  connection: Connection | undefined,
  modelName: string,
  t: ReturnType<typeof useTranslation<'providers'>>['t'],
): string {
  const connectionName = connection?.name ?? t('aliases.unavailableConnection');
  const contextText = !alias.contextChoice
    ? t('aliases.tuple.connectionContextDefault')
    : 'tier' in alias.contextChoice
      ? alias.contextChoice.tier === 'long'
        ? t('aliases.tuple.extendedContext')
        : t('aliases.tuple.standardContext')
      : t('aliases.tuple.windowContext', {
          size: formatContextWindow(alias.contextChoice.contextWindow),
        });
  const effortText = alias.thinkingLevel
    ? t('aliases.tuple.effortValue', { level: t(`thinkingLevels.levels.${alias.thinkingLevel}`) })
    : t('aliases.tuple.modelEffortDefault');
  return [connectionName, modelName, contextText, effortText].join(' · ');
}

/**
 * Manages named 4-tuple model aliases on Settings -> Providers, including cold-start starter
 * suggestions when providers are connected and no aliases exist yet.
 */
export function ModelAliasesSection({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const [starterDismissed, setStarterDismissed] = useState(false);
  const [dialog, setDialog] = useState<{ open: boolean; alias: ModelAlias | null }>({
    open: false,
    alias: null,
  });
  const [confirmDelete, setConfirmDelete] = useState<ModelAlias | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!snapshot) return null;
  const { aliases, connections, defaultAliasId, defaultConnectionId } = snapshot;
  const hasConnectedCatalog = connections.some((c) => c.connected && c.catalog.length > 0);
  if (aliases.length === 0 && connections.length === 0) return null;

  async function toggleDefault(alias: ModelAlias, nextDefault: boolean) {
    if (!bridge || busy) return;
    setError('');
    setBusy(true);
    try {
      await bridge.setDefaultAlias(nextDefault ? alias.id : null);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemove(alias: ModelAlias) {
    if (!bridge || busy) return;
    setError('');
    setBusy(true);
    try {
      await bridge.removeAlias(alias.id);
      setConfirmDelete(null);
    } catch (reason) {
      setError(messageOf(reason));
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  }

  const atLimit = aliases.length >= MAX_MODEL_ALIASES;

  return (
    <section
      className="settings-group model-aliases-section"
      data-settings-anchor="settings-providers-aliases"
      aria-labelledby="settings-providers-aliases-title"
    >
      <div className="settings-group-header">
        <div className="settings-group-heading">
          <h3 id="settings-providers-aliases-title" className="settings-section-title">
            {t('aliases.title')}
          </h3>
          <p className="text-sm text-muted-foreground">{t('aliases.description')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!bridge || busy || !hasConnectedCatalog || atLimit}
          onClick={() => setDialog({ open: true, alias: null })}
        >
          <Plus aria-hidden="true" />
          {t('aliases.add')}
        </Button>
      </div>

      {atLimit && (
        <p className="settings-field-note">
          {t('aliases.limitReached', { max: MAX_MODEL_ALIASES })}
        </p>
      )}
      {error && (
        <p className="settings-inline-error" role="alert">
          <CircleAlert aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}

      {aliases.length === 0 && !starterDismissed && hasConnectedCatalog && (
        <ModelAliasStarters
          connections={connections}
          defaultConnectionId={defaultConnectionId}
          disabled={busy}
          onDismiss={() => setStarterDismissed(true)}
          onCreateCustom={() => setDialog({ open: true, alias: null })}
          onSeeded={() => setError('')}
        />
      )}

      {aliases.length > 0 && (
        <ItemGroup className="provider-connections">
          {aliases.map((alias) => {
            const connection = connections.find((c) => c.connectionId === alias.connectionId);
            const presentation = connection ? providerPresentation(connection) : null;
            const catalogModel = connection?.catalog.find((m) => m.id === alias.modelId);
            const available = Boolean(connection?.connected && catalogModel);
            const isDefault = defaultAliasId === alias.id;
            const tuple = aliasDescription(
              alias,
              connection,
              catalogModel?.name ?? alias.modelId,
              t,
            );
            const menu = (
              <>
                <ItemMenuItem disabled={busy} onSelect={() => setDialog({ open: true, alias })}>
                  <Pencil aria-hidden="true" />
                  {t('aliases.actions.edit')}
                </ItemMenuItem>
                <ItemMenuItem
                  disabled={busy}
                  onSelect={() => void toggleDefault(alias, !isDefault)}
                >
                  <Check aria-hidden="true" />
                  {isDefault ? t('aliases.actions.clearDefault') : t('aliases.actions.setDefault')}
                </ItemMenuItem>
                <ItemMenuSeparator />
                <ItemMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={() => setConfirmDelete(alias)}
                >
                  <Trash2 aria-hidden="true" />
                  {t('aliases.actions.delete')}
                </ItemMenuItem>
              </>
            );
            return (
              <ItemContextMenu key={alias.id} menu={menu}>
                <Item
                  asChild
                  size="sm"
                  variant="outline"
                  className="open-row provider-connection-row"
                >
                  <li>
                    <button
                      type="button"
                      className="open-row-button"
                      aria-label={t('aliases.actions.editFor', { name: alias.name })}
                      disabled={busy}
                      onClick={() => setDialog({ open: true, alias })}
                    />
                    <div className="provider-identity">
                      <ProviderBrand
                        provider={
                          presentation?.service.brand ?? connection?.provider ?? 'openai-compatible'
                        }
                      />
                      <ItemContent>
                        <div className="provider-name-track">
                          <ItemTitle className="min-w-0" title={alias.name}>
                            {alias.name}
                          </ItemTitle>
                          {isDefault && (
                            <Badge variant="secondary">{t('connections.defaultBadge')}</Badge>
                          )}
                          {!available && (
                            <Badge variant="outline">{t('aliases.unavailableBadge')}</Badge>
                          )}
                        </div>
                        <ItemDescription className="whitespace-normal">{tuple}</ItemDescription>
                      </ItemContent>
                    </div>
                    <ItemActions className="model-alias-actions">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={busy}
                        onClick={() => setDialog({ open: true, alias })}
                      >
                        {t('aliases.actions.edit')}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <IconButton
                            label={t('connections.more')}
                            aria-label={t('aliases.actionsLabel', { name: alias.name })}
                            disabled={busy}
                            tooltip={false}
                          >
                            <Ellipsis />
                          </IconButton>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" sideOffset={4} collisionPadding={8}>
                          {menu}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </ItemActions>
                  </li>
                </Item>
              </ItemContextMenu>
            );
          })}
        </ItemGroup>
      )}

      <ModelAliasDialog
        open={dialog.open}
        alias={dialog.alias}
        aliases={aliases}
        defaultAliasId={defaultAliasId}
        connections={connections}
        defaultConnectionId={defaultConnectionId}
        onOpenChange={(open) => {
          if (!open) setDialog({ open: false, alias: null });
        }}
      />

      <AlertDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aliases.delete.title', { name: confirmDelete?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('aliases.delete.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('aliases.delete.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmDelete) void confirmRemove(confirmDelete);
              }}
            >
              {t('aliases.delete.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
