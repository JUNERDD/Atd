import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  parse,
  MigrationCredentialSchema,
  type CredentialUploadRequest,
  type MigrationCredentialRecord,
  type ServiceConnection,
} from '@ai/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend, keyringAccount } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';
import type { DesktopSettings } from './sources.js';

/**
 * Providers importer. Connection metadata moves from desktop settings.json
 * into the service ConnectionStore without secrets; secrets arrive only via
 * the authenticated credential-upload channel after a one-time Electron
 * safeStorage decrypt. Model checks run locally (credential resolution, no
 * network) where credentials are available, else stay `unchecked`.
 */
const KNOWN_AUTH = new Set(['api_key', 'oauth', 'none', 'ambient']);

export function mapDesktopConnection(
  connection: DesktopSettings['connections'][number],
  configurationId: string,
  at: string,
): ServiceConnection {
  return {
    connectionId: connection.connectionId,
    provider: connection.provider.slice(0, 256),
    name: connection.name.slice(0, 120),
    baseUrl: connection.baseUrl.slice(0, 2048),
    authType:
      KNOWN_AUTH.has(connection.authType) === true
        ? (connection.authType as ServiceConnection['authType'])
        : 'api_key',
    defaultModel: connection.defaultModel.slice(0, 256),
    revision: connection.revision,
    connected: false,
    hasCredential: false,
    configurationId: configurationId.slice(0, 256),
    verifiedModel: '',
    migratedAt: at,
  };
}

export async function importProvidersMetadata(
  connections: ConnectionStore,
  settings: DesktopSettings,
  configurationIdFor: (connection: DesktopSettings['connections'][number]) => string,
  at: string,
): Promise<{ inserted: number; identical: number }> {
  let inserted = 0;
  let identical = 0;
  for (const connection of settings.connections) {
    const mapped = mapDesktopConnection(connection, configurationIdFor(connection), at);
    const outcome = await connections.upsertMigrated(mapped);
    if (outcome === 'inserted') inserted += 1;
    else identical += 1;
  }
  if (settings.defaultConnectionId) {
    await connections.change((data) => {
      if (
        data.connections.some((item) => item.connectionId === settings.defaultConnectionId) &&
        !data.defaultConnectionId
      )
        data.defaultConnectionId = settings.defaultConnectionId;
    });
  }
  return { inserted, identical };
}

export interface UploadOutcome {
  readable: boolean;
  modelCheck: MigrationCredentialRecord['modelCheck'];
  detail: string;
}

/**
 * Applies one authenticated credential upload: validates the configuration
 * binding, persists the secret to the keyring, marks the connection, then
 * reads back and runs the local model check. Secret values never leave this
 * module except into the keyring.
 */
export async function applyCredentialUpload(
  connections: ConnectionStore,
  keyring: KeyringBackend,
  upload: CredentialUploadRequest,
): Promise<UploadOutcome> {
  const credential = parse(MigrationCredentialSchema, upload.credential);
  const stored = connections.connection(upload.connectionId);
  if (stored.provider !== upload.providerId)
    throw new Error('Credential upload targets the wrong provider.');
  if (stored.configurationId !== upload.configurationId)
    throw new Error('The connection configuration changed.');
  await keyring.set(keyringAccount(upload.connectionId), JSON.stringify(credential));
  await connections.change((data) => {
    const item = data.connections.find((entry) => entry.connectionId === upload.connectionId);
    if (!item) throw new Error('This connection no longer exists.');
    item.hasCredential = true;
    item.connected = true;
  });
  const raw = await keyring.get(keyringAccount(upload.connectionId));
  if (!raw) throw new Error('The uploaded credential could not be read back.');
  parse(MigrationCredentialSchema, JSON.parse(raw));
  return modelCheck(connections, keyring, upload.connectionId);
}

/**
 * Local model-connection check: resolves auth through the service credential
 * store without network access. Unknown (custom) providers are registered
 * minimally so the check still exercises credential resolution only.
 */
export async function modelCheck(
  connections: ConnectionStore,
  keyring: KeyringBackend,
  connectionId: string,
): Promise<UploadOutcome> {
  const connection = connections.connection(connectionId);
  if (!connection.hasCredential)
    return { readable: false, modelCheck: 'unchecked', detail: 'No credential uploaded yet.' };
  try {
    const models = await ModelRuntime.create({
      credentials: new ServiceCredentialStore(
        keyring,
        connections,
        connection.connectionId,
        connection.provider,
        connection.configurationId,
      ),
      modelsPath: null,
      refreshOnCreate: false,
    });
    if (!models.getProvider(connection.provider))
      models.registerProvider(connection.provider, {
        api: 'openai-completions',
        baseUrl: connection.baseUrl || undefined,
        models: [],
      });
    const ok = await models.checkAuth(connection.provider);
    return ok
      ? { readable: true, modelCheck: 'passed', detail: 'Credential resolves locally.' }
      : { readable: true, modelCheck: 'failed', detail: 'Credential did not resolve.' };
  } catch (error) {
    return {
      readable: true,
      modelCheck: 'failed',
      detail: error instanceof Error ? error.message.slice(0, 500) : 'Model check failed.',
    };
  }
}
