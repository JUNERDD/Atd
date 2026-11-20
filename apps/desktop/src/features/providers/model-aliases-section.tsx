import { useState } from 'react';
import { CircleAlert, Plug, Plus, SearchX, SlidersHorizontal } from 'lucide-react';
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
import { Button } from '@atd/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { ItemGroup } from '@atd/ui/components/item';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { ItemsPlaceholder, LoadingPlaceholder } from '../../components/loading-placeholder';
import { messageOf } from '../../lib/errors';
import { ModelAliasDialog } from './model-alias-dialog';
import { ModelAliasRow } from './model-alias-row';
import { AddProviderButton, type AddProviderAction } from './provider-connections-tab';

interface ModelAliasesSectionProps {
  snapshot: SettingsSnapshot | null;
  loading: boolean;
  query: string;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onClearSearch: () => void;
  addProvider: AddProviderAction;
}

/** Manages named 4-tuple model aliases inside the Model aliases tab of Settings -> Models. */
export function ModelAliasesSection({
  snapshot,
  loading,
  query,
  createOpen,
  onCreateOpenChange,
  onClearSearch,
  addProvider,
}: ModelAliasesSectionProps) {
  const { t } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const [editingAlias, setEditingAlias] = useState<ModelAlias | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ModelAlias | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connections = snapshot?.connections ?? [];
  const aliases = snapshot?.aliases ?? [];
  const defaultAliasId = snapshot?.defaultAliasId ?? null;
  const defaultConnectionId = snapshot?.defaultConnectionId ?? null;
  const hasUsableConnection = connections.some((c) => c.connected && c.catalog.length > 0);
  const atLimit = aliases.length >= MAX_MODEL_ALIASES;

  const visible = aliases.flatMap((alias) => {
    const connection = connections.find((c) => c.connectionId === alias.connectionId);
    const catalogModel = connection?.catalog.find((m) => m.id === alias.modelId);
    const match = matchFields(query, {
      name: alias.name,
      model: catalogModel?.name,
      modelId: alias.modelId,
      connection: connection?.name,
    });
    return match || !query.trim()
      ? [{ alias, connection, catalogModel, nameRanges: match?.ranges.name }]
      : [];
  });

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

  const dialogOpen = createOpen || Boolean(editingAlias);
  const dialogAlias = createOpen ? null : editingAlias;
  const searching = aliases.length > 0;
  const emptyTitle = searching
    ? t('aliases.empty.noMatchesTitle', { query: query.trim() })
    : t(hasUsableConnection ? 'aliases.empty.firstTitle' : 'aliases.empty.noProvidersTitle');
  const emptyDescription = t(
    searching
      ? 'aliases.empty.noMatchesDescription'
      : hasUsableConnection
        ? 'aliases.empty.firstDescription'
        : 'aliases.empty.noProvidersDescription',
  );
  const emptyIcon = searching ? (
    <SearchX />
  ) : hasUsableConnection ? (
    <SlidersHorizontal />
  ) : (
    <Plug />
  );

  return (
    <>
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
      {loading ? (
        <LoadingPlaceholder label={t('aliases.loading')}>
          <ItemsPlaceholder count={2} variant="outline" trailing="none" />
        </LoadingPlaceholder>
      ) : visible.length ? (
        <ItemGroup className="provider-connections">
          {visible.map(({ alias, connection, catalogModel, nameRanges }) => (
            <ModelAliasRow
              key={alias.id}
              alias={alias}
              connection={connection}
              catalogModel={catalogModel}
              nameRanges={nameRanges}
              isDefault={defaultAliasId === alias.id}
              busy={busy}
              onEdit={() => {
                onCreateOpenChange(false);
                setEditingAlias(alias);
              }}
              onToggleDefault={() => void toggleDefault(alias, defaultAliasId !== alias.id)}
              onDelete={() => setConfirmDelete(alias)}
            />
          ))}
        </ItemGroup>
      ) : (
        <Empty className="px-4 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">{emptyIcon}</EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {searching ? (
              <Button variant="outline" onClick={onClearSearch}>
                {t('aliases.empty.clearSearch')}
              </Button>
            ) : hasUsableConnection ? (
              <Button
                variant="outline"
                disabled={!bridge || busy}
                onClick={() => {
                  setEditingAlias(null);
                  onCreateOpenChange(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t('aliases.add')}
              </Button>
            ) : (
              <AddProviderButton
                action={addProvider}
                label={t('aliases.empty.addProvider')}
                variant="outline"
              />
            )}
          </EmptyContent>
        </Empty>
      )}

      <ModelAliasDialog
        open={dialogOpen}
        alias={dialogAlias}
        aliases={aliases}
        defaultAliasId={defaultAliasId}
        connections={connections}
        defaultConnectionId={defaultConnectionId}
        onOpenChange={(open) => {
          if (!open) {
            onCreateOpenChange(false);
            setEditingAlias(null);
          }
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
    </>
  );
}
