import { safeStorage } from 'electron';
import type { ProviderConnection, ProviderDraft, ProviderSettings } from './settings-contract';

const OPENAI_URL = 'https://api.openai.com/v1';
const MAX_RESPONSE_BYTES = 1_048_576;

export interface StoredProvider {
  id: ProviderSettings['id'];
  baseUrl: string;
  model: string;
  encryptedApiKey: string;
}

export function defaultProvider(): StoredProvider {
  return { id: 'openai', baseUrl: OPENAI_URL, model: '', encryptedApiKey: '' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function providerUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) {
    throw new TypeError('Enter a valid base URL.');
  }
  const source = value.trim();
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new TypeError('Enter a valid base URL.');
  }
  if (!/^https?:\/\//.test(source) || /[\s\\?#]/.test(source) || url.username || url.password) {
    throw new TypeError('Base URLs cannot contain credentials, queries, or fragments.');
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '[::1]' ||
    /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new TypeError('Use HTTPS, or HTTP with a loopback address.');
  }
  const normalized = url.href.replace(/\/+$/, '');
  if (normalized.length > 2048) throw new TypeError('The base URL is too long.');
  return normalized;
}

function apiKeyValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > 8192 ||
    hasControlCharacters(value)
  ) {
    throw new TypeError('Enter a valid API key.');
  }
  return value.trim();
}

function parseDraft(value: unknown): ProviderDraft {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['id', 'baseUrl', 'model', 'apiKey'].includes(key)) ||
    (value.id !== 'openai' && value.id !== 'openai-compatible') ||
    typeof value.model !== 'string' ||
    value.model.length > 256 ||
    hasControlCharacters(value.model)
  ) {
    throw new TypeError('Invalid provider settings.');
  }
  const baseUrl = providerUrl(value.baseUrl);
  if (value.id === 'openai' && baseUrl !== OPENAI_URL) {
    throw new TypeError('OpenAI uses https://api.openai.com/v1.');
  }
  return {
    id: value.id,
    baseUrl,
    model: value.model.trim(),
    ...(value.apiKey === undefined ? {} : { apiKey: apiKeyValue(value.apiKey) }),
  };
}

export function parseStoredProvider(value: unknown): StoredProvider {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) => !['id', 'baseUrl', 'model', 'encryptedApiKey'].includes(key),
    ) ||
    typeof value.encryptedApiKey !== 'string' ||
    value.encryptedApiKey.length > 32_768 ||
    (value.encryptedApiKey !== '' &&
      (!/^[A-Za-z0-9+/]+={0,2}$/.test(value.encryptedApiKey) ||
        Buffer.from(value.encryptedApiKey, 'base64').toString('base64') !== value.encryptedApiKey))
  ) {
    throw new TypeError('Invalid saved provider settings.');
  }
  const draft = parseDraft({ id: value.id, baseUrl: value.baseUrl, model: value.model });
  return {
    id: draft.id,
    baseUrl: draft.baseUrl,
    model: draft.model,
    encryptedApiKey: value.encryptedApiKey,
  };
}

function assertEncryptionAvailable() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('Secure credential storage is unavailable on this device.');
  }
}

function retainedCredential(draft: ProviderDraft, current: StoredProvider): string {
  if (draft.baseUrl !== current.baseUrl && current.encryptedApiKey) {
    throw new Error('Enter an API key again, or explicitly clear it, when changing the base URL.');
  }
  return current.encryptedApiKey;
}

export function saveProviderDraft(value: unknown, current: StoredProvider): StoredProvider {
  const draft = parseDraft(value);
  let encryptedApiKey = '';
  if (draft.apiKey === undefined) encryptedApiKey = retainedCredential(draft, current);
  else if (draft.apiKey) {
    assertEncryptionAvailable();
    try {
      encryptedApiKey = safeStorage.encryptString(draft.apiKey).toString('base64');
    } catch {
      throw new Error('The API key could not be encrypted on this device.');
    }
  }
  return { id: draft.id, baseUrl: draft.baseUrl, model: draft.model, encryptedApiKey };
}

function connectionKey(draft: ProviderDraft, current: StoredProvider): string {
  if (draft.apiKey !== undefined) return draft.apiKey;
  const encrypted = retainedCredential(draft, current);
  if (!encrypted) return '';
  assertEncryptionAvailable();
  try {
    return apiKeyValue(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
  } catch {
    throw new Error('The saved API key could not be unlocked. Enter it again.');
  }
}

async function responseModels(response: Response): Promise<string[]> {
  if (!response.body) throw new Error('Missing response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!isRecord(result) || 'error' in result || !Array.isArray(result.data)) {
    throw new Error('Missing model list');
  }
  const models: string[] = [];
  for (const model of result.data) {
    if (
      !isRecord(model) ||
      typeof model.id !== 'string' ||
      !model.id.trim() ||
      model.id.length > 256 ||
      hasControlCharacters(model.id)
    ) {
      throw new Error('Invalid model');
    }
    models.push(model.id);
  }
  return [...new Set(models)].sort((left, right) => left.localeCompare(right));
}

export async function testProviderDraft(
  value: unknown,
  current: StoredProvider,
): Promise<ProviderConnection> {
  const draft = parseDraft(value);
  const apiKey = connectionKey(draft, current);
  const signal = AbortSignal.timeout(15_000);
  let response: Response;
  try {
    response = await fetch(`${draft.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      redirect: 'error',
      signal,
    });
  } catch {
    throw new Error(
      signal.aborted
        ? 'The connection timed out.'
        : 'Could not connect to the provider. Check the base URL and network.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'The provider rejected the API key or its permissions.'
        : `The provider returned HTTP ${response.status}.`,
    );
  }
  try {
    return { models: await responseModels(response) };
  } catch {
    throw new Error(
      signal.aborted
        ? 'The connection timed out.'
        : 'The provider did not return a valid model list.',
    );
  }
}

/** Main-process-only credential access for a frozen Agent connection. */
export function agentCredential(current: StoredProvider): string {
  return connectionKey({ id: current.id, baseUrl: current.baseUrl, model: current.model }, current);
}
