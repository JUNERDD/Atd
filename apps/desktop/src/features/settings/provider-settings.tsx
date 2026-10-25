import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CircleAlert, Plug, Plus, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@atd/ui/components/empty';
import { matchFields } from '@atd/ui/lib/fuzzy-match';
import { useCompositionQuery } from '@atd/ui/lib/ime';
import type { SettingsSnapshot } from '../../client/settings-contract';
import type { Connection } from '../../client/providers/schema';
import {
  providerSearchAliases,
  serviceForConnection,
  type ProviderService,
} from '../providers/provider-services';
import {
  ConnectionConfirmDialog,
  type ConnectionConfirm,
} from '../providers/connection-confirm-dialog';
import { ProviderConnections } from '../providers/provider-connections';
import { ProviderCatalog } from '../providers/provider-catalog';
import { ProviderServiceForm } from '../providers/provider-service-form';
import { ItemsPlaceholder, LoadingPlaceholder } from '../../components/loading-placeholder';
import { showErrorToast, showToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { bridgeKeys } from '../../lib/bridge-cache';
import { useServiceStatus } from '../service/use-service';
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
  | { page: 'form'; service: ProviderService; connectionId: string | null };
const OVERVIEW: ProviderRoute = { page: 'overview' };

export function ProviderSettingsForm({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const { t } = useTranslation('settings');
  const { t: tp } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const connected = useServiceStatus().status?.state === 'connected';
  // A failed load keeps an inline message with Retry, which stays (busy) while it asks again.
  const catalogQuery = useQuery(
    {
      queryKey: [...bridgeKeys.serviceLists, 'providers', 'catalog'],
      queryFn: () => {
        if (!bridge) throw new Error('Open the desktop app to manage providers.');
        return bridge.catalog();
      },
      enabled: Boolean(bridge) && connected,
      // Like the other service lists, reload on section entry and service reconnect.
      gcTime: Infinity,
      meta: { errorToast: false },
    },
    queryClient,
  );
  const catalog = catalogQuery.data ?? [];
  const catalogHasError =
    catalogQuery.isError || (!catalogQuery.data && catalogQuery.errorUpdateCount > 0);
  const catalogStatus = catalogHasError
    ? catalogQuery.isFetching
      ? 'retrying'
      : 'failed'
    : catalogQuery.data
      ? 'ready'
      : 'loading';
  const connections = snapshot?.connections ?? [];
  // The connections load apart from the settings: until they arrive, placeholder rows stand in for
  // them, rather than the empty state's invitation to connect a first provider.
  const connectionsLoading = connected && !snapshot?.providersLoaded;
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
  const [confirming, setConfirming] = useState<ConnectionConfirm | null>(null);
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
  async function manage(connection: Connection) {
    let available = catalog;
    let provider = catalog.find((item) => item.id === connection.provider);
    if (!provider) {
      // Only a fresh, successful catalog can establish that a provider was removed.
      const refreshed = await catalogQuery.refetch({ cancelRefetch: false });
      if (refreshed.isError) return;
      available = refreshed.data ?? [];
      provider = available.find((item) => item.id === connection.provider);
    }
    if (!provider) {
      showErrorToast(t('providers.overview.disconnect.missingProvider'));
      return;
    }
    const service = serviceForConnection(available, connection);
    if (service)
      history.replace({ page: 'form', service, connectionId: connection.connectionId }, view);
  }
  if (view.page === 'catalog')
    return (
      <ProviderCatalog
        catalog={catalog}
        onChoose={(service) => history.open({ page: 'form', service, connectionId: null })}
      />
    );
  if (view.page === 'form')
    return (
      <ProviderServiceForm
        key={view.service.id}
        service={view.service}
        connection={connections.find((item) => item.connectionId === view.connectionId) ?? null}
        onBack={history.back}
        // A new connection's page becomes the saved connection's, which Forward then reopens.
        onSaved={(connection) =>
          history.replace({ ...view, connectionId: connection.connectionId }, view)
        }
      />
    );
  // Match provider identity even after the user renames a connection; highlight only visible text.
  const visible = connections.flatMap((connection) => {
    const provider = catalog.find((item) => item.id === connection.provider)?.name;
    const match = matchFields(search.query, {
      name: connection.name,
      provider,
      aliases: providerSearchAliases(connection, tp),
    });
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
      {connectionsLoading ? (
        <LoadingPlaceholder label={t('providers.overview.loading')}>
          <ItemsPlaceholder count={2} variant="outline" trailing="none" />
        </LoadingPlaceholder>
      ) : null}
      <ProviderConnections
        rows={visible}
        defaultConnectionId={snapshot?.defaultConnectionId ?? null}
        pending={pending}
        canManage={catalogReady && !catalogQuery.isFetching}
        onManage={(connection) => void manage(connection)}
        onConfirm={setConfirming}
        perform={perform}
      />
      {!visible.length && !connectionsLoading && (
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
      <ConnectionConfirmDialog
        confirm={confirming}
        isDefault={confirming?.connection.connectionId === snapshot?.defaultConnectionId}
        pending={pending}
        onDismiss={() => setConfirming(null)}
        onConfirm={({ action, connection }) =>
          void perform(async () => {
            const { connectionId, revision } = connection;
            if (action === 'remove') {
              const warning = await bridge!.remove(connectionId, revision);
              if (warning) showToast({ kind: 'info', text: warning });
            } else await bridge!.disconnect(connectionId, revision);
            setConfirming(null);
          })
        }
      />
    </section>
  );
}
