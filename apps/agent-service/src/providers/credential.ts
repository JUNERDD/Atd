import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  parse,
  ProviderCredentialSchema,
  type ProviderConnectRequest,
  type ProviderConnectResponse,
} from '@atd/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend, keyringAccount } from '../credentials/keyring.js';
import { ServiceCredentialStore } from '../credentials/service-store.js';

/** Local verdict on a stored credential; `detail` never carries secret values. */
export interface CredentialCheck {
  readable: boolean;
  modelCheck: ProviderConnectResponse['modelCheck'];
  detail: string;
}

/**
 * Stores one connection's credential: validates the configuration binding,
 * persists the secret to the keyring, marks the connection, then reads it back
 * and runs the local model check. Secret values never leave this module except
 * into the keyring.
 */
export async function storeConnectionCredential(
  connections: ConnectionStore,
  keyring: KeyringBackend,
  request: ProviderConnectRequest,
): Promise<CredentialCheck> {
  const credential = parse(ProviderCredentialSchema, request.credential);
  const stored = connections.connection(request.connectionId);
  if (stored.provider !== request.providerId)
    throw new Error('Credential upload targets the wrong provider.');
  if (stored.configurationId !== request.configurationId)
    throw new Error('The connection configuration changed.');
  await keyring.set(keyringAccount(request.connectionId), JSON.stringify(credential));
  await connections.change((data) => {
    const item = data.connections.find((entry) => entry.connectionId === request.connectionId);
    if (!item) throw new Error('This connection no longer exists.');
    item.hasCredential = true;
    item.connected = true;
  });
  const raw = await keyring.get(keyringAccount(request.connectionId));
  if (!raw) throw new Error('The uploaded credential could not be read back.');
  parse(ProviderCredentialSchema, JSON.parse(raw));
  return modelCheck(connections, keyring, request.connectionId);
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
): Promise<CredentialCheck> {
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
        ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
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
