import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, Plug, Plus, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@ai/ui/components/empty';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { useCompositionQuery } from '@ai/ui/lib/ime';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@ai/ui/components/alert-dialog';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { Connection, ProviderCatalogEntry } from '../../client/providers/schema';
import { ProviderConnections } from '../providers/provider-connections';
import { ProviderCatalog } from '../providers/provider-catalog';
import { ProviderForm } from '../providers/provider-form';
import { showErrorToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { SettingsHeading } from './settings-heading';
import { SettingsSearchField } from './settings-search-field';
import { useSettingsSectionExit } from './settings-navigation';
import { useSettingsPageHistory } from './use-settings-page-history';
import '../providers/providers.css';

/**
 * A page of the Providers section: the connections, the provider catalog, or one provider's form
 * for a new connection (`connectionId` null) or a saved one.
 */
type ProviderRoute =
  | { page: 'overview' }
  | { page: 'catalog' }
  | { page: 'form'; provider: ProviderCatalogEntry; connectionId: string | null };
const OVERVIEW: ProviderRoute = { page: 'overview' };

export function ProviderSettingsForm({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const bridge = window.desktop?.settings.providers;
  // A failed load keeps an inline message with Retry, which stays (busy) while it asks again.
  const catalogQuery = useQuery(
    {
      queryKey: ['providers', 'catalog'],
      queryFn: () => {
        if (!bridge) throw new Error('Open the desktop app to manage providers.');
        return bridge.catalog();
      },
      enabled: Boolean(bridge),
      // Read once, as when the section kept its own copy; Retry reads again after a failure.
      staleTime: Infinity,
      gcTime: Infinity,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const catalog = catalogQuery.data ?? [];
  const catalogStatus = catalogQuery.data
    ? 'ready'
    : catalogQuery.errorUpdateCount === 0
      ? 'loading'
      : catalogQuery.isFetching
        ? 'retrying'
        : 'failed';
  const connections = snapshot?.connections ?? [];
  // Forward cannot reopen a connection that was disconnected meanwhile.
  const history = useSettingsPageHistory<ProviderRoute>(
    OVERVIEW,
    (route) =>
      route.page !== 'form' ||
      route.connectionId === null ||
      connections.some((item) => item.connectionId === route.connectionId),
  );
  const view = history.route;
  const search = useCompositionQuery();
  useSettingsSectionExit(() => search.change(''));
  // An operation on a connection; a failure shows its toast and offers Retry, which runs the
  // failed operation again, until something succeeds.
  const operation = useMutation(
    {
      mutationKey: ['providers', 'operation'],
      mutationFn: (run: () => Promise<void>) => run(),
    },
    queryClient,
  );
  const pending = operation.isPending;
  const retryable = operation.isError;
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const catalogReady = catalogStatus === 'ready';
  const catalogFailed = catalogStatus === 'failed' || catalogStatus === 'retrying';
  /** Opens the catalog; the Add buttons stay focusable while it cannot load, and say why. */
  function addProvider() {
    if (bridge && catalogReady) history.open({ page: 'catalog' });
  }
  /** Runs an operation on a connection, unless one is already running. */
  function perform(run: () => Promise<void>) {
    if (pending) return Promise.resolve();
    return operation.mutateAsync(run).catch(() => {});
  }
  function manage(connection: Connection) {
    const provider = catalog.find((item) => item.id === connection.provider);
    if (!provider) {
      showErrorToast(t('providers.overview.disconnect.missingProvider'));
      return;
    }
    history.open({ page: 'form', provider, connectionId: connection.connectionId });
  }
  if (view.page === 'catalog')
    return (
      <ProviderCatalog
        catalog={catalog}
        onChoose={(provider) => history.open({ page: 'form', provider, connectionId: null })}
      />
    );
  if (view.page === 'form')
    return (
      <ProviderForm
        key={view.provider.id}
        provider={view.provider}
        connection={connections.find((item) => item.connectionId === view.connectionId) ?? null}
        onBack={history.back}
        // A new connection's page becomes the saved connection's, which Forward then reopens.
        onSaved={(connection) =>
          history.replace({ ...view, connectionId: connection.connectionId }, view)
        }
      />
    );
  // Rows keep their order. The search marks the connection name and also matches the provider's
  // name, which the row shows as its logo; the no-match hint suggests both.
  const visible = connections.flatMap((connection) => {
    const provider = catalog.find((item) => item.id === connection.provider)?.name;
    const match = matchFields(search.query, { name: connection.name, provider });
    return match || !search.query.trim() ? [{ connection, nameRanges: match?.ranges.name }] : [];
  });
  const emptyTitle = connections.length
    ? t('providers.overview.empty.noMatchesTitle', { query: search.query.trim() })
    : t('providers.overview.empty.firstTitle');
  const emptyDescription = t(
    connections.length
      ? 'providers.overview.empty.noMatchesDescription'
      : 'providers.overview.empty.firstDescription',
  );
  function clear() {
    search.change('');
    searchInput.current?.focus();
  }
  return (
    <section className="providers-overview">
      <SettingsHeading
        title={t('providers.overview.title')}
        description={t('providers.overview.description')}
      >
        <SettingsSearchField
          ref={searchInput}
          search={search}
          aria-label={t('providers.overview.searchLabel')}
          placeholder={t('providers.overview.searchPlaceholder')}
          disabled={!connections.length}
        />
        <Button
          className="aria-disabled:opacity-50"
          disabled={!bridge}
          aria-disabled={!catalogReady || undefined}
          aria-describedby={catalogFailed ? 'provider-catalog-error' : undefined}
          onClick={addProvider}
        >
          <Plus />
          {t('providers.overview.addProvider')}
        </Button>
      </SettingsHeading>
      {catalogFailed && (
        <div className="provider-catalog-error">
          <p id="provider-catalog-error" className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{t('providers.overview.catalogError')}</span>
          </p>
          <Button
            variant="outline"
            size="xs"
            aria-disabled={catalogStatus === 'retrying' || undefined}
            aria-busy={catalogStatus === 'retrying' || undefined}
            onClick={() => {
              if (catalogStatus !== 'retrying') void catalogQuery.refetch();
            }}
          >
            {t('providers.overview.retry')}
          </Button>
        </div>
      )}
      {retryable && (
        <div className="settings-status">
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() => {
              const failed = operation.variables;
              if (failed) void perform(failed);
            }}
          >
            {t('providers.overview.retry')}
          </Button>
        </div>
      )}
      <ProviderConnections
        rows={visible}
        defaultConnectionId={snapshot?.defaultConnectionId ?? null}
        pending={pending}
        canManage={catalogReady}
        onManage={manage}
        onDisconnect={setDisconnecting}
        perform={perform}
      />
      {!visible.length && (
        <Empty className="px-4 py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">{connections.length ? <SearchX /> : <Plug />}</EmptyMedia>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {connections.length ? (
              <Button variant="outline" onClick={clear}>
                {t('providers.overview.empty.clearSearch')}
              </Button>
            ) : (
              // Follows the header's Add provider: unavailable, and why, while the catalog is.
              <Button
                variant="outline"
                className="aria-disabled:opacity-50"
                disabled={!bridge}
                aria-disabled={!catalogReady || undefined}
                aria-describedby={catalogFailed ? 'provider-catalog-error' : undefined}
                onClick={addProvider}
              >
                <Plus />
                {t('providers.overview.addProvider')}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      )}
      <AlertDialog
        open={Boolean(disconnecting)}
        onOpenChange={(open) => {
          if (!open && !pending) setDisconnecting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('providers.overview.disconnect.title', { name: disconnecting?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('providers.overview.disconnect.description')}
              {disconnecting?.connectionId === snapshot?.defaultConnectionId &&
                t('providers.overview.disconnect.defaultNote')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('providers.overview.disconnect.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (disconnecting)
                  void perform(async () => {
                    await bridge!.disconnect(disconnecting.connectionId, disconnecting.revision);
                    setDisconnecting(null);
                  });
              }}
            >
              {t('providers.overview.disconnect.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
