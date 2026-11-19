import type { ComponentProps } from 'react';
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
import type { Connection } from '../../client/providers/schema';
import { ItemsPlaceholder, LoadingPlaceholder } from '../../components/loading-placeholder';
import type { ConnectionConfirm } from './connection-confirm-dialog';
import { ProviderConnections } from './provider-connections';

/** Shared action contract so Add provider buttons keep focus and catalog-error semantics. */
export interface AddProviderAction {
  disabled: boolean;
  unavailable: boolean;
  describedBy?: string | undefined;
  onClick: () => void;
}

/** Add provider button preserving focusability and error description while the catalog fails. */
export function AddProviderButton({
  action,
  label,
  variant = 'default',
}: {
  action: AddProviderAction;
  label: string;
  variant?: 'default' | 'outline';
}) {
  return (
    <Button
      variant={variant}
      className="aria-disabled:opacity-50"
      disabled={action.disabled}
      aria-disabled={action.unavailable || undefined}
      aria-describedby={action.describedBy}
      onClick={action.onClick}
    >
      <Plus aria-hidden="true" />
      {label}
    </Button>
  );
}

/** Catalog-load and failed-operation retry banners shown on the Models overview. */
export function ProviderOverviewAlerts({
  catalogFailed,
  catalogRetrying,
  onRetryCatalog,
  retryable,
  pending,
  onRetryOperation,
}: {
  catalogFailed: boolean;
  catalogRetrying: boolean;
  onRetryCatalog: () => void;
  retryable: boolean;
  pending: boolean;
  onRetryOperation: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <>
      {catalogFailed && (
        <div className="provider-catalog-error">
          <p id="provider-catalog-error" className="settings-inline-error" role="alert">
            <CircleAlert aria-hidden="true" />
            <span>{t('providers.overview.catalogError')}</span>
          </p>
          <Button
            variant="outline"
            size="xs"
            aria-disabled={catalogRetrying || undefined}
            aria-busy={catalogRetrying || undefined}
            onClick={() => {
              if (!catalogRetrying) onRetryCatalog();
            }}
          >
            {t('providers.overview.retry')}
          </Button>
        </div>
      )}
      {retryable && (
        <div className="settings-status">
          <Button variant="outline" size="xs" disabled={pending} onClick={onRetryOperation}>
            {t('providers.overview.retry')}
          </Button>
        </div>
      )}
    </>
  );
}

interface ProviderConnectionsTabProps {
  loading: boolean;
  connectionsCount: number;
  rows: ComponentProps<typeof ProviderConnections>['rows'];
  query: string;
  defaultConnectionId: string | null;
  pending: boolean;
  canManage: boolean;
  addProvider: AddProviderAction;
  onManage: (connection: Connection) => void;
  onConfirm: (confirm: ConnectionConfirm) => void;
  perform: (run: () => Promise<void>) => Promise<void>;
  onClearSearch: () => void;
}

/** Provider connections tab content: loading state, connection list, or empty state. */
export function ProviderConnectionsTab({
  loading,
  connectionsCount,
  rows,
  query,
  defaultConnectionId,
  pending,
  canManage,
  addProvider,
  onManage,
  onConfirm,
  perform,
  onClearSearch,
}: ProviderConnectionsTabProps) {
  const { t } = useTranslation('settings');

  if (loading) {
    return (
      <LoadingPlaceholder label={t('providers.overview.loading')}>
        <ItemsPlaceholder count={2} variant="outline" trailing="none" />
      </LoadingPlaceholder>
    );
  }

  if (rows.length) {
    return (
      <ProviderConnections
        rows={rows}
        defaultConnectionId={defaultConnectionId}
        pending={pending}
        canManage={canManage}
        onManage={onManage}
        onConfirm={onConfirm}
        perform={perform}
      />
    );
  }

  const emptyTitle = connectionsCount
    ? t('providers.overview.empty.noMatchesTitle', { query: query.trim() })
    : t('providers.overview.empty.firstTitle');
  const emptyDescription = t(
    connectionsCount
      ? 'providers.overview.empty.noMatchesDescription'
      : 'providers.overview.empty.firstDescription',
  );

  return (
    <Empty className="px-4 py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">{connectionsCount ? <SearchX /> : <Plug />}</EmptyMedia>
        <EmptyTitle>{emptyTitle}</EmptyTitle>
        <EmptyDescription>{emptyDescription}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {connectionsCount ? (
          <Button variant="outline" onClick={onClearSearch}>
            {t('providers.overview.empty.clearSearch')}
          </Button>
        ) : (
          <AddProviderButton
            action={addProvider}
            label={t('providers.overview.addProvider')}
            variant="outline"
          />
        )}
      </EmptyContent>
    </Empty>
  );
}
