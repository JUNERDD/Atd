import {
  connectProvider,
  disconnectProvider,
  listCatalog,
  listProviders,
  type AgentClientOptions,
} from '@ai/agent-client';
import type { ServiceConnection } from '@ai/agent-contracts';
import { LOCAL_PROVIDERS } from './metadata';
import type { Connection, ConnectionDraft, ProviderCatalogEntry } from './schema';
import { providerFuture } from '../agent/service-manage';

/** Maps a secret-free service connection into the desktop settings row. */
export function toDesktopConnection(connection: ServiceConnection): Connection {
  return {
    connectionId: connection.connectionId,
    provider: connection.provider,
    name: connection.name,
    baseUrl: connection.baseUrl,
    authType: connection.authType,
    defaultModel: connection.defaultModel,
    revision: connection.revision,
    connected: connection.connected,
    hasCredential: connection.hasCredential,
    verifiedModel: connection.verifiedModel,
    options: {},
    customModels: [],
    catalog: [],
    catalogError: '',
  };
}

/** Local fallback catalog from LOCAL_PROVIDERS; never empty (5 entries). */
export function localCatalog(): ProviderCatalogEntry[] {
  return LOCAL_PROVIDERS.map((provider) => ({
    ...provider,
    category: 'local' as const,
    auth: [
      { type: 'none' as const, label: 'No API key' },
      { type: 'api_key' as const, label: 'API key' },
    ],
    models: [],
  }));
}

/** Maps a service catalog entry onto the desktop shape (contract v1: identical). */
export function toCatalogEntry(entry: ProviderCatalogEntry): ProviderCatalogEntry {
  return {
    id: entry.id,
    name: entry.name,
    category: entry.category,
    auth: entry.auth.map((item) => ({ type: item.type, label: item.label })),
    baseUrl: entry.baseUrl,
    models: entry.models,
  };
}

/** Service catalog when connected, else the local fallback. Never resolves []. */
export async function fetchCatalog(
  options: AgentClientOptions | null,
): Promise<ProviderCatalogEntry[]> {
  const fallback = localCatalog();
  if (!options) return fallback;
  try {
    const { catalog } = await listCatalog(options);
    if (catalog.length === 0) return fallback;
    return catalog.map(toCatalogEntry);
  } catch {
    return fallback;
  }
}

export async function fetchLiveProviders(options: AgentClientOptions): Promise<{
  defaultConnectionId: string | null;
  connections: Connection[];
}> {
  const listed = await listProviders(options);
  return {
    defaultConnectionId: listed.defaultConnectionId,
    connections: listed.connections.map(toDesktopConnection),
  };
}

export async function connectLive(
  options: AgentClientOptions,
  draft: ConnectionDraft,
): Promise<Connection> {
  if (!draft.connectionId) providerFuture();
  const listed = await listProviders(options);
  const live = listed.connections.find((item) => item.connectionId === draft.connectionId);
  if (!live) throw new Error('This connection was not found on the service.');
  if (draft.authType === 'oauth') providerFuture();
  const credential =
    draft.authType === 'api_key'
      ? { type: 'api_key' as const, ...(draft.apiKey ? { key: draft.apiKey } : {}) }
      : { type: 'api_key' as const };
  const connected = await connectProvider(options, draft.connectionId, {
    connectionId: draft.connectionId,
    providerId: live.provider,
    configurationId: live.configurationId,
    credential,
  });
  return toDesktopConnection(connected.connection);
}

export async function disconnectLive(
  options: AgentClientOptions,
  connectionId: string,
  expectedRevision: number,
): Promise<Connection> {
  const disconnected = await disconnectProvider(options, connectionId, expectedRevision);
  return toDesktopConnection(disconnected.connection);
}
