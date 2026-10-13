import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { defaultProviderAuthContext } from '@earendil-works/pi-ai';
import {
  parse,
  ProviderCredentialSchema,
  type ProviderConnectRequest,
  type ProviderConnectResponse,
} from '@atd/agent-contracts';
import { ConnectionStore } from '../credentials/connections.js';
import { KeyringBackend, keyringAccount } from '../credentials/keyring.js';
import {
  ServiceCredentialStore,
  type CredentialWriteOptions,
} from '../credentials/service-store.js';
import { assertCredential, assertUploadedCredential } from './auth-policy.js';
import { connectionAuthContext } from './auth-context.js';
import { isLocalProvider } from './catalog.js';

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
  options?: CredentialWriteOptions,
): Promise<CredentialCheck> {
  const credential = parse(ProviderCredentialSchema, request.credential);
  const stored = connections.connection(request.connectionId);
  if (stored.provider !== request.providerId)
    throw new Error('Credential upload targets the wrong provider.');
  if (stored.configurationId !== request.configurationId)
    throw new Error('The connection configuration changed.');
  assertUploadedCredential(stored, credential);
  await new ServiceCredentialStore(
    keyring,
    connections,
    stored.connectionId,
    stored.provider,
    stored.configurationId,
  ).modify(stored.provider, async () => credential, options);
  const raw = await keyring.get(keyringAccount(request.connectionId));
  if (!raw) throw new Error('The uploaded credential could not be read back.');
  parse(ProviderCredentialSchema, JSON.parse(raw));
  return modelCheck(connections, keyring, request.connectionId);
}

/**
 * Local model-connection check: resolves auth through the service credential
 * store without network access. Saved options and ambient opt-in follow the
 * request runtime; OAuth is checked locally without refreshing its token.
 */
export async function modelCheck(
  connections: ConnectionStore,
  keyring: KeyringBackend,
  connectionId: string,
): Promise<CredentialCheck> {
  const connection = connections.connection(connectionId);
  if (!connection.hasCredential)
    return { readable: false, modelCheck: 'unchecked', detail: 'No credential uploaded yet.' };
  let readable = false;
  try {
    const credentials = new ServiceCredentialStore(
      keyring,
      connections,
      connectionId,
      connection.provider,
      connection.configurationId,
    );
    const credential = await credentials.read(connection.provider);
    if (!credential)
      return { readable: false, modelCheck: 'failed', detail: 'Reconnect this provider.' };
    readable = true;
    let ok = credential.type === 'oauth' || connection.authType === 'none';
    if (!ok && credential.type === 'api_key') {
      if (isLocalProvider(connection.provider)) ok = Boolean(credential.key);
      else {
        const models = await ModelRuntime.create({
          credentials,
          modelsPath: null,
          refreshOnCreate: false,
        });
        const apiKey = models.getProvider(connection.provider)?.auth.apiKey;
        if (apiKey) {
          const options = connection.options ?? {};
          const input = {
            credential: { ...credential, env: options },
            ctx: connectionAuthContext(connection, defaultProviderAuthContext()),
            signal: AbortSignal.timeout(15000),
          };
          // A provider's local check avoids request-time credential work such as commands.
          const resolved = await (apiKey.check ? apiKey.check(input) : apiKey.resolve(input));
          if (resolved && 'auth' in resolved && resolved.auth.apiKey)
            assertCredential(connection, { type: 'api_key', key: resolved.auth.apiKey });
          ok = Boolean(resolved);
        }
      }
    }
    return ok
      ? { readable: true, modelCheck: 'passed', detail: 'Credential resolves locally.' }
      : { readable: true, modelCheck: 'failed', detail: 'Credential did not resolve.' };
  } catch {
    return {
      readable,
      modelCheck: 'failed',
      detail: 'The stored credential could not be used. Reconnect this provider.',
    };
  }
}
