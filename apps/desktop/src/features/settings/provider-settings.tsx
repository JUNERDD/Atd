import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MAX_MODEL_ALIASES } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@atd/ui/components/tabs';
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
import { ProviderCatalog } from '../providers/provider-catalog';
import {
  AddProviderButton,
  ProviderConnectionsTab,
  ProviderOverviewAlerts,
  type AddProviderAction,
} from '../providers/provider-connections-tab';
import { ModelAliasesSection } from '../providers/model-aliases-section';
import { ProviderServiceForm } from '../providers/provider-service-form';
import { showErrorToast, showToast } from '../../components/toast-store';
import { queryClient } from '../../lib/query-client';
import { bridgeKeys } from '../../lib/bridge-cache';
import { useServiceStatus } from '../service/use-service';
import { SettingsHeading } from './settings-heading';
import { SettingsSearchField } from './settings-search-field';
import { useSettingsSectionExit, type SettingsPageTarget } from './settings-navigation';
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
type ProvidersTab = 'providers' | 'aliases';
const OVERVIEW: ProviderRoute = { page: 'overview' };

export function ProviderSettingsForm({
  snapshot,
  activePage,
}: {
  snapshot: SettingsSnapshot | null;
  activePage?: SettingsPageTarget | null;
}) {
  const { t } = useTranslation('settings');
  const { t: tp } = useTranslation('providers');
  const bridge = window.desktop?.settings.providers;
  const connected = useServiceStatus().status?.state === 'connected';
  const hasUnreadableIssue = (snapshot?.connections ?? []).some(
    (connection) => connection.credentialIssue === 'unreadable',
  );
  // Automatic usage reads also touch the OS keychain. Wait for the sequential status probe and
  // stop entirely while one connection is unreadable, so opening Settings never cascades prompts.
  const usageEnabled = !hasUnreadableIssue && snapshot?.providerStatusesChecked === true;
  useEffect(() => {
    if (connected && bridge && !hasUnreadableIssue) {
      void bridge.checkStatuses().catch(() => undefined);
    }
  }, [bridge, connected, hasUnreadableIssue]);
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
  const aliases = snapshot?.aliases ?? [];
  const usableConnections = connections.filter((c) => c.connected && c.catalog.length > 0);
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
  const [tab, setTab] = useState<ProvidersTab>('providers');
  const [createAliasOpen, setCreateAliasOpen] = useState(false);
  const [linked, setLinked] = useState<number | null>(null);
  useSettingsSectionExit(() => {
    setTab('providers');
    setCreateAliasOpen(false);
    search.change('');
  });
  if (activePage?.section === 'providers' && activePage.nonce !== linked) {
    setLinked(activePage.nonce);
    history.reset();
    search.change('');
    setCreateAliasOpen(false);
    setTab(activePage.page === 'modelAliases' ? 'aliases' : 'providers');
  }
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
  const addAliasDisabled =
    !bridge || !usableConnections.length || aliases.length >= MAX_MODEL_ALIASES;
  const addProviderAction: AddProviderAction = {
    disabled: !bridge,
    unavailable: !catalogReady,
    describedBy: catalogFailed ? 'provider-catalog-error' : undefined,
    onClick: addProvider,
  };
  function clear() {
    search.change('');
    searchInput.current?.focus();
  }
  function handleTabChange(next: string) {
    setTab(next as ProvidersTab);
    setCreateAliasOpen(false);
    search.change('');
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
          aria-label={t(
            tab === 'aliases'
              ? 'providers.overview.searchAliasesLabel'
              : 'providers.overview.searchLabel',
          )}
          placeholder={t(
            tab === 'aliases'
              ? 'providers.overview.searchAliasesPlaceholder'
              : 'providers.overview.searchPlaceholder',
          )}
          disabled={tab === 'aliases' ? !aliases.length : !connections.length}
        />
        {tab === 'aliases' ? (
          <Button disabled={addAliasDisabled} onClick={() => setCreateAliasOpen(true)}>
            <Plus />
            {tp('aliases.add')}
          </Button>
        ) : (
          <AddProviderButton
            action={addProviderAction}
            label={t('providers.overview.addProvider')}
          />
        )}
      </SettingsHeading>
      <ProviderOverviewAlerts
        catalogFailed={catalogFailed}
        catalogRetrying={catalogStatus === 'retrying'}
        onRetryCatalog={() => void catalogQuery.refetch()}
        retryable={retryable}
        pending={pending}
        onRetryOperation={() => {
          const failed = operation.variables;
          if (failed) void perform(failed);
        }}
      />
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList
          aria-label={t('providers.overview.tabsLabel')}
          className="scrollbar-none max-w-full justify-start overflow-x-auto overflow-y-hidden"
        >
          <TabsTrigger value="providers" className="flex-none px-2.5">
            {t('providers.overview.tabs.providers')}
            {!connectionsLoading && (
              <span className="text-muted-foreground tabular-nums">{connections.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="aliases"
            className="flex-none px-2.5"
            data-settings-anchor="settings-providers-aliases"
          >
            {t('providers.overview.tabs.aliases')}
            {!connectionsLoading && (
              <span className="text-muted-foreground tabular-nums">{aliases.length}</span>
            )}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="providers" className="providers-overview-tab">
          <ProviderConnectionsTab
            loading={connectionsLoading}
            connectionsCount={connections.length}
            rows={visible}
            query={search.query}
            defaultConnectionId={snapshot?.defaultConnectionId ?? null}
            pending={pending}
            canManage={catalogReady && !catalogQuery.isFetching}
            usageEnabled={usageEnabled}
            addProvider={addProviderAction}
            onManage={(connection) => void manage(connection)}
            onConfirm={setConfirming}
            perform={perform}
            onClearSearch={clear}
          />
        </TabsContent>
        <TabsContent value="aliases" className="providers-overview-tab">
          <ModelAliasesSection
            snapshot={snapshot}
            loading={connectionsLoading}
            query={search.query}
            createOpen={createAliasOpen}
            onCreateOpenChange={setCreateAliasOpen}
            onClearSearch={clear}
            addProvider={addProviderAction}
          />
        </TabsContent>
      </Tabs>
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
