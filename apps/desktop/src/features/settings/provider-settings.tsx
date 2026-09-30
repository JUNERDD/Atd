import { useEffect, useRef, useState } from 'react';
import { Plug, SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { matchFields } from '@ai/ui/lib/fuzzy-match';
import { isComposingKey, useCompositionQuery } from '@ai/ui/lib/ime';
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
import { showErrorToast, showToast } from '../../components/toast-store';
import { SettingsHeading } from './settings-heading';
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
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
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
  const [pending, setPending] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.catalog().then(
      (value) => {
        if (active) setCatalog(value);
      },
      (error) => {
        if (!active) return;
        setRetryable(true);
        showErrorToast(error);
      },
    );
    return () => {
      active = false;
    };
  }, [bridge]);
  async function perform(operation: () => Promise<void>, success = '') {
    if (pending) return;
    retry.current = () => perform(operation, success);
    setPending(true);
    setRetryable(false);
    try {
      await operation();
      if (success) showToast({ kind: 'info', text: success });
      retry.current = null;
    } catch (error) {
      setRetryable(true);
      showErrorToast(error);
    } finally {
      setPending(false);
    }
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
  const emptyTitle = t(
    connections.length
      ? 'providers.overview.empty.noMatchesTitle'
      : 'providers.overview.empty.firstTitle',
  );
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
        <Input
          ref={searchInput}
          aria-label={t('providers.overview.searchLabel')}
          placeholder={t('providers.overview.searchPlaceholder')}
          value={search.text}
          disabled={!connections.length}
          onChange={(event) => search.change(event.target.value)}
          {...search.compositionProps}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && search.text && !isComposingKey(event)) {
              event.stopPropagation();
              clear();
            }
          }}
        />
        <Button
          disabled={!bridge || !catalog.length}
          onClick={() => history.open({ page: 'catalog' })}
        >
          {t('providers.overview.addProvider')}
        </Button>
      </SettingsHeading>
      {retryable && (
        <div className="settings-status">
          <Button
            variant="outline"
            size="xs"
            disabled={pending}
            onClick={() =>
              void (retry.current
                ? retry.current()
                : perform(async () => {
                    if (bridge) setCatalog(await bridge.catalog());
                  }))
            }
          >
            {t('providers.overview.retry')}
          </Button>
        </div>
      )}
      {connections.length > 0 && (
        <div className="provider-column-headings">
          <span>{t('providers.overview.connectedProviders')}</span>
          <span>{t('providers.overview.defaultModel')}</span>
        </div>
      )}
      <ProviderConnections
        rows={visible}
        defaultConnectionId={snapshot?.defaultConnectionId ?? null}
        pending={pending}
        onManage={manage}
        onDisconnect={setDisconnecting}
        perform={perform}
      />
      {!visible.length && (
        <div className="provider-empty">
          {connections.length ? <SearchX size={24} /> : <Plug size={24} />}
          <h3 title={emptyTitle}>{emptyTitle}</h3>
          <p title={emptyDescription}>{emptyDescription}</p>
          <Button
            variant="outline"
            disabled={!bridge}
            onClick={connections.length ? clear : () => history.open({ page: 'catalog' })}
          >
            {connections.length
              ? t('providers.overview.empty.clearSearch')
              : t('providers.overview.addProvider')}
          </Button>
        </div>
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
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (disconnecting)
                  void perform(async () => {
                    await bridge!.disconnect(disconnecting.connectionId, disconnecting.revision);
                    setDisconnecting(null);
                  }, t('providers.overview.disconnect.done'));
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
