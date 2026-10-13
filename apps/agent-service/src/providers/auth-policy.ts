import { parse, type ProviderCredential, type ServiceConnection } from '@atd/agent-contracts';
import { ChatGPTCredentialSchema } from './chatgpt-storage.js';

/** Only flows with a supported application integration are offered as account login. */
export const ACCOUNT_PROVIDERS = new Set(['openai', 'openrouter', 'radius']);
export const CHATGPT_BASE_URL = 'https://api.openai.com/v1';

export function assertProviderAuth(
  connection: Pick<
    ServiceConnection,
    'provider' | 'authType' | 'baseUrl' | 'options' | 'customModels'
  >,
): void {
  if (connection.provider === 'openai-codex')
    throw new TypeError('The legacy Codex connection is retired. Continue with ChatGPT instead.');
  if (connection.authType !== 'oauth') return;
  if (!ACCOUNT_PROVIDERS.has(connection.provider))
    throw new TypeError('Account login is not supported for this provider. Use an API key.');
  if (connection.provider === 'openai' && connection.baseUrl !== CHATGPT_BASE_URL)
    throw new TypeError('ChatGPT plan usage requires the public OpenAI API endpoint.');
  if (
    (connection.provider === 'openrouter' &&
      connection.baseUrl !== 'https://openrouter.ai/api/v1') ||
    (connection.provider === 'radius' &&
      !['', 'https://radius.pi.dev'].includes(connection.baseUrl))
  )
    throw new TypeError('Account login requires the provider’s official endpoint.');
  if (Object.keys(connection.options ?? {}).length || connection.customModels?.length)
    throw new TypeError('Account login uses the provider’s model catalog and configuration.');
}

export function assertCredential(
  connection: Pick<ServiceConnection, 'provider' | 'authType' | 'baseUrl'>,
  credential: ProviderCredential,
): void {
  assertProviderAuth(connection);
  if ((connection.authType === 'oauth') !== (credential.type === 'oauth'))
    throw new TypeError('The credential does not match this connection’s authentication method.');
  if (connection.provider === 'openai' && connection.authType === 'oauth')
    parse(ChatGPTCredentialSchema, credential);
  if (
    connection.provider === 'google-vertex' &&
    connection.authType !== 'ambient' &&
    credential.type === 'api_key' &&
    credential.key
  ) {
    const key = credential.key.trim();
    // Pi's transport treats these as absent keys and would otherwise select ADC itself.
    if (!key || key === 'gcp-vertex-credentials' || /^<[^>]+>$/.test(key))
      throw new TypeError(
        'Enter a Google Cloud API key or configure an explicit credentials file.',
      );
  }
  if (
    connection.provider === 'anthropic' &&
    credential.type === 'api_key' &&
    credential.key?.startsWith('sk-ant-oat')
  )
    throw new TypeError(
      'Claude subscription tokens are not supported. Enter an Anthropic API key.',
    );
}

/** Credentials from account login must be minted by the service’s authorized flow. */
export function assertUploadedCredential(
  connection: Pick<ServiceConnection, 'provider' | 'authType' | 'baseUrl'>,
  credential: ProviderCredential,
): void {
  if (credential.type === 'oauth')
    throw new TypeError('Use the sign-in button to authorize this account.');
  assertCredential(connection, credential);
}

/** Retire stored unsupported flows without treating their old tokens as a new authorization. */
export function retireLegacyLogin(connection: ServiceConnection): boolean {
  const codex =
    connection.provider === 'openai-codex' ||
    (connection.provider === 'openai' &&
      connection.authType === 'oauth' &&
      !connection.oauthProtocol);
  if (!codex && (connection.authType !== 'oauth' || ACCOUNT_PROVIDERS.has(connection.provider)))
    return false;
  if (codex) {
    connection.provider = 'openai';
    connection.baseUrl = CHATGPT_BASE_URL;
    connection.authType = 'oauth';
    connection.oauthProtocol = 'siwc';
    if (connection.name === 'ChatGPT / Codex' || connection.name === 'OpenAI Codex')
      connection.name = 'ChatGPT';
    connection.authNotice =
      'This connection now uses Sign in with ChatGPT. Sign in again to authorize Atd.';
  } else {
    connection.authType = 'api_key';
    connection.authNotice =
      'Account login was retired for this provider. Enter your API key to reconnect.';
  }
  connection.connected = false;
  connection.hasCredential = false;
  connection.credentialCleanupPending = true;
  delete connection.accountLabel;
  connection.verifiedModel = '';
  connection.defaultModel = '';
  delete connection.defaultThinkingLevel;
  delete connection.catalog;
  delete connection.catalogError;
  delete connection.contextTiers;
  connection.customModels = [];
  connection.options = {};
  connection.revision += 1;
  return true;
}
