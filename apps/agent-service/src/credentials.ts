import type { AuthOperationOptions, Credential, CredentialInfo } from '@earendil-works/pi-ai';

/**
 * Explicit temporary credentials injected through the environment only, for
 * runs without a saved provider connection. No keyring, no file storage,
 * nothing logged; a missing key is a truthful `auth_required`.
 */
export interface TempCredentialConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
}

/** Reads temp credentials; returns null when the operator injected none. */
export function readTempCredentials(): TempCredentialConfig | null {
  const apiKey = process.env.AI_AGENT_TEMP_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    provider: process.env.AI_AGENT_TEMP_PROVIDER?.trim() || 'openai-compatible',
    apiKey,
    baseUrl: process.env.AI_AGENT_TEMP_BASE_URL?.trim() || '',
  };
}

/** Pi credential store backed solely by the injected temp key. */
export class TempCredentialStore {
  private readonly key: string | null;

  constructor() {
    this.key = process.env.AI_AGENT_TEMP_API_KEY?.trim() || null;
  }

  hasCredentials(): boolean {
    return this.key !== null;
  }

  async read(_providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    if (!this.key) return undefined;
    return { type: 'api_key', key: this.key };
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return [];
  }

  async modify(
    _providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    // Temp credentials are fixed for the process; refresh writes are refused so
    // no caller mistakes them for persisted OAuth state.
    const current = await this.read(_providerId, options);
    const next = await fn(current);
    if (JSON.stringify(next ?? null) !== JSON.stringify(current ?? null))
      throw new Error('Persistent credential storage is unavailable (T2 owns it).');
    return current;
  }

  async delete(_providerId: string, options?: AuthOperationOptions): Promise<void> {
    options?.signal?.throwIfAborted();
    throw new Error('Persistent credential storage is unavailable (T2 owns it).');
  }
}

/** Truthful auth failure surfaced as `auth_required`, never a faked turn. */
export class AuthRequired extends Error {
  constructor(detail = 'No model credentials are available.') {
    super(detail);
    this.name = 'AuthRequired';
  }
}
