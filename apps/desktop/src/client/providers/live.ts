import {
  createProvider,
  disconnectProvider,
  getProvider,
  listCatalog,
  listProviders,
  removeProvider,
  updateProvider,
  type AgentClientOptions,
} from '@atd/agent-client';
import type {
  ProviderCredential,
  ProviderCredentialChange,
  ServiceConnection,
} from '@atd/agent-contracts';
import { validateConfig } from './configuration';
import type { Connection, ConnectionDraft, ProviderCatalogEntry } from './schema';

/** Maps a secret-free service connection into the desktop settings row. */
export function toDesktopConnection(connection: ServiceConnection): Connection {
  return {
    connectionId: connection.connectionId,
    provider: connection.provider,
    name: connection.name,
    baseUrl: connection.baseUrl,
    authType: connection.authType,
    defaultModel: connection.defaultModel,
    ...(connection.defaultThinkingLevel
      ? { defaultThinkingLevel: connection.defaultThinkingLevel }
      : {}),
    ...(connection.contextTiers ? { contextTiers: { ...connection.contextTiers } } : {}),
    ...(connection.contextWindows ? { contextWindows: { ...connection.contextWindows } } : {}),
    revision: connection.revision,
    connected: connection.connected,
    ...(connection.authNotice ? { authNotice: connection.authNotice } : {}),
    ...(connection.accountLabel ? { accountLabel: connection.accountLabel } : {}),
    ...(connection.chatgptConsent ? { chatgptConsent: connection.chatgptConsent } : {}),
    ...(connection.chatgptPlanEnabled === undefined
      ? {}
      : { chatgptPlanEnabled: connection.chatgptPlanEnabled }),
    ...(connection.chatgptUsagePaused === undefined
      ? {}
      : { chatgptUsagePaused: connection.chatgptUsagePaused }),
    hasCredential: connection.hasCredential,
    verifiedModel: connection.verifiedModel,
    // The service fills these on every response; absent only on stored records.
    options: connection.options ?? {},
    customModels: connection.customModels ?? [],
    catalog: connection.catalog ?? [],
    catalogError: connection.catalogError ?? '',
  };
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

/** A failed read must remain a failure: a partial fallback hides saved providers in the UI. */
export async function fetchCatalog(options: AgentClientOptions): Promise<ProviderCatalogEntry[]> {
  const { catalog } = await listCatalog(options);
  if (!catalog.length) throw new Error('The provider catalog could not be loaded.');
  return catalog.map(toCatalogEntry);
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

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

/** Trims an entered API key; control characters mean a paste went wrong. */
function apiKeyCredential(apiKey: string): ProviderCredential {
  const key = apiKey.trim();
  if (hasControlCharacter(key)) throw new Error('Enter a valid API key.');
  return { type: 'api_key', key };
}

/**
 * Keyless connections (no API key, ambient cloud credentials) connect with an
 * empty credential; API-key connections need an entered key; account-login
 * connections receive theirs from sign-in.
 */
function initialCredential(draft: ConnectionDraft): ProviderCredential | null {
  if (draft.authType === 'none' || draft.authType === 'ambient') return { type: 'api_key' };
  if (draft.authType === 'api_key' && draft.apiKey?.trim()) return apiKeyCredential(draft.apiKey);
  return null;
}

/**
 * The draft's `apiKey` is absent to keep the saved key and empty to remove
 * it. A disconnected keyless connection reconnects when saved.
 */
function credentialChange(
  draft: ConnectionDraft,
  live: ServiceConnection,
): ProviderCredentialChange {
  if (draft.authType === 'api_key' && draft.apiKey !== undefined)
    return draft.apiKey.trim()
      ? { action: 'replace', credential: apiKeyCredential(draft.apiKey) }
      : { action: 'remove' };
  const keyless = draft.authType === 'none' || draft.authType === 'ambient';
  return keyless && !live.hasCredential
    ? { action: 'replace', credential: { type: 'api_key' } }
    : { action: 'keep' };
}

/**
 * Saves a connection draft: creates it when the draft has no id yet, else
 * replaces the editable configuration of the connection the service owns.
 * The endpoint is normalized and checked before anything reaches the service.
 */
export async function saveLive(
  options: AgentClientOptions,
  draft: ConnectionDraft,
): Promise<Connection> {
  validateConfig(draft);
  const configuration = {
    name: draft.name,
    baseUrl: draft.baseUrl,
    defaultModel: draft.defaultModel,
    ...(draft.defaultThinkingLevel ? { defaultThinkingLevel: draft.defaultThinkingLevel } : {}),
    options: draft.options,
    customModels: draft.customModels,
    ...(draft.provider === 'openai' && draft.authType === 'oauth' && draft.chatgptConsent
      ? { chatgptConsent: draft.chatgptConsent }
      : {}),
  };
  if (!draft.connectionId) {
    const created = await createProvider(options, {
      ...configuration,
      provider: draft.provider,
      authType: draft.authType,
      credential: initialCredential(draft),
    });
    return toDesktopConnection(created.connection);
  }
  if (!draft.expectedRevision)
    throw new Error('This connection changed. Reload its saved settings before saving.');
  const { connection: live } = await getProvider(options, draft.connectionId);
  if (live.provider !== draft.provider || live.authType !== draft.authType)
    throw new Error('Add a separate connection to change the provider or authentication method.');
  const updated = await updateProvider(options, draft.connectionId, {
    ...configuration,
    expectedRevision: draft.expectedRevision,
    credential: credentialChange(draft, live),
    ...(draft.resumeChatGPTUsage ? { resumeChatGPTUsage: true } : {}),
  });
  return toDesktopConnection(updated.connection);
}

export async function disconnectLive(
  options: AgentClientOptions,
  connectionId: string,
  expectedRevision: number,
): Promise<Connection> {
  const disconnected = await disconnectProvider(options, connectionId, expectedRevision);
  return toDesktopConnection(disconnected.connection);
}

export async function removeLive(
  options: AgentClientOptions,
  connectionId: string,
  expectedRevision: number,
): Promise<string | undefined> {
  return (await removeProvider(options, connectionId, expectedRevision)).warning;
}
