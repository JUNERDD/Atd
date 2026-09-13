import { useEffect, useRef, useState } from 'react';
import { Plug, SearchX } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { commandFilter } from '@ai/ui/components/command';
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
import type { SettingsSnapshot } from '../../../electron/settings-contract';
import type { Connection, ProviderCatalogEntry } from '../../../electron/providers/schema';
import { ProviderConnections } from '../providers/provider-connections';
import { ProviderCatalog } from '../providers/provider-catalog';
import { ProviderForm } from '../providers/provider-form';
import { messageOf } from '../agent/use-agent';
import { SettingsHeading } from './settings-heading';
import '../providers/providers.css';

export function ProviderSettingsForm({ snapshot }: { snapshot: SettingsSnapshot | null }) {
  const bridge = window.desktop?.settings.providers;
  const [catalog, setCatalog] = useState<ProviderCatalogEntry[]>([]);
  const [view, setView] = useState<
    'overview' | 'catalog' | { provider: ProviderCatalogEntry; connectionId: string | null }
  >('overview');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [disconnecting, setDisconnecting] = useState<Connection | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const connections = snapshot?.connections ?? [];
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.catalog().then(
      (value) => {
        if (active) setCatalog(value);
      },
      (error) => {
        if (active) setError(messageOf(error));
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
    setError('');
    setNotice('');
    try {
      await operation();
      setNotice(success);
      retry.current = null;
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  function manage(connection: Connection) {
    const provider = catalog.find((item) => item.id === connection.provider);
    if (!provider) {
      setError('This provider is no longer registered. Its saved connection has been preserved.');
      return;
    }
    setView({ provider, connectionId: connection.connectionId });
  }
  if (view === 'catalog')
    return (
      <ProviderCatalog
        catalog={catalog}
        onBack={() => setView('overview')}
        onChoose={(provider) => setView({ provider, connectionId: null })}
      />
    );
  if (typeof view === 'object')
    return (
      <ProviderForm
        key={view.provider.id}
        provider={view.provider}
        connection={connections.find((item) => item.connectionId === view.connectionId) ?? null}
        onBack={() => setView('overview')}
        onSaved={(connection) =>
          setView((current) =>
            current === view ? { ...view, connectionId: connection.connectionId } : current,
          )
        }
      />
    );
  const visible = connections.filter(
    (connection) =>
      commandFilter(
        `${connection.name} ${connection.provider} ${catalog.find((item) => item.id === connection.provider)?.name ?? ''}`,
        query.trim(),
      ) > 0,
  );
  const emptyTitle = connections.length ? 'No matching providers' : 'Connect your first provider';
  const emptyDescription = connections.length
    ? 'Try a connection or provider name.'
    : 'Add an account, API key, cloud service or local connection.';
  function clear() {
    setQuery('');
    search.current?.focus();
  }
  return (
    <section className="providers-overview">
      <SettingsHeading
        title="Providers"
        description="Choose a default provider and set a default model for each connection."
      >
        <Input
          ref={search}
          aria-label="Search providers"
          placeholder="Search providers…"
          value={query}
          disabled={!connections.length}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              event.stopPropagation();
              clear();
            }
          }}
        />
        <Button disabled={!bridge || !catalog.length} onClick={() => setView('catalog')}>
          Add provider
        </Button>
      </SettingsHeading>
      {error && (
        <div role="alert" className="settings-status" data-error="true">
          {error}{' '}
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
            Try again
          </Button>
        </div>
      )}
      {notice && <output className="settings-status">{notice}</output>}
      {connections.length > 0 && (
        <div className="provider-column-headings">
          <span>Connected providers</span>
          <span>Default model</span>
        </div>
      )}
      <ProviderConnections
        connections={visible}
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
            onClick={connections.length ? clear : () => setView('catalog')}
          >
            {connections.length ? 'Clear search' : 'Add provider'}
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
            <AlertDialogTitle>Disconnect {disconnecting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Credentials will be removed. Saved model references remain available for repair.
              {disconnecting?.connectionId === snapshot?.defaultConnectionId &&
                ' New tasks using the app default will require reconnection or another default provider.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                if (disconnecting)
                  void perform(async () => {
                    await bridge!.disconnect(disconnecting.connectionId, disconnecting.revision);
                    setDisconnecting(null);
                  }, 'Provider disconnected.');
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
