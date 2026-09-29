import { safeStorage } from 'electron';
import { Type } from 'typebox';
import type { MigrationCredential } from '@ai/agent-contracts';
import { parse } from '../../src/client/agent/validation';

const CredentialSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal('api_key'),
      key: Type.Optional(Type.String()),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('oauth'),
      access: Type.String(),
      refresh: Type.String(),
      expires: Type.Number(),
    },
    { additionalProperties: false },
  ),
]);

function secureStorage() {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  )
    throw new Error('Secure credential storage is unavailable on this device.');
}

/**
 * T6 pure client: one-time decrypt for migration upload only. No Pi
 * CredentialStore, no ConnectionCredentials, no encrypt path (saves are
 * disabled until the service delivers provider APIs). Secret values never
 * reach logs; undecryptable entries resolve to re-prompt verdicts upstream.
 */
export function decryptCredential(encrypted: string): MigrationCredential | undefined {
  if (!encrypted) return undefined;
  secureStorage();
  try {
    if (encrypted.startsWith('legacy:'))
      return {
        type: 'api_key',
        key: safeStorage.decryptString(Buffer.from(encrypted.slice(7), 'base64')),
      };
    return parse(
      CredentialSchema,
      JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64'))),
    );
  } catch {
    throw new Error('The saved credentials could not be unlocked. Reconnect this provider.');
  }
}
