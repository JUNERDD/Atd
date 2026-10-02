import { readFile } from 'node:fs/promises';
import { Type, type Static } from 'typebox';
import {
  McpBearerAuthSchema,
  McpHttpSchema,
  McpNoneAuthSchema,
  McpOAuthAuthSchema,
  McpServerConfigSchema,
  McpServerExposureSchema,
  McpStdioSchema,
  parse,
  type McpServerConfig,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { keyringMcpAccount, keyringMcpSecretAccount } from '../credentials/keyring.js';
import { announceMcpChanged } from './changes.js';
import { credentialIdentity, serversFile } from './servers.js';

/**
 * `servers.json` as it is at rest (server-store.ts owns reading values back and writing them):
 * each server with the NAMES of its stdio env and HTTP header entries and, for a pre-registered
 * OAuth client, whether it has a secret, each value in plain text or as a keyring ref. A server
 * saved before exposure existed has none and loads as `auto`.
 */

/** Marks a value the keyring holds. */
const KeyringRefSchema = Type.Object(
  { keyring: Type.Literal(true) },
  { additionalProperties: false },
);
export const KEYRING_REF: Static<typeof KeyringRefSchema> = { keyring: true };

const StoredValueSchema = Type.Union([Type.String({ maxLength: 8192 }), KeyringRefSchema]);
export type StoredValue = Static<typeof StoredValueSchema>;

const StoredValuesSchema = Type.Record(Type.String(), StoredValueSchema);
export type StoredValues = Static<typeof StoredValuesSchema>;

const StoredAuthSchema = Type.Union([
  McpNoneAuthSchema,
  McpBearerAuthSchema,
  Type.Object(
    { ...McpOAuthAuthSchema.properties, clientSecret: Type.Optional(StoredValueSchema) },
    { additionalProperties: false },
  ),
]);
export type StoredAuth = Static<typeof StoredAuthSchema>;

const StoredServerSchema = Type.Object(
  {
    ...McpServerConfigSchema.properties,
    exposure: Type.Optional(McpServerExposureSchema),
    stdio: Type.Union([
      Type.Object(
        { ...McpStdioSchema.properties, env: StoredValuesSchema },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
    http: Type.Union([
      Type.Object(
        { ...McpHttpSchema.properties, headers: StoredValuesSchema, auth: StoredAuthSchema },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
/** A server as `servers.json` stores it: each secret value in plain text or a keyring ref. */
export type StoredServer = Static<typeof StoredServerSchema>;

const ServerFileSchema = Type.Object(
  { version: Type.Literal(1), servers: Type.Array(StoredServerSchema) },
  { additionalProperties: false },
);

export type SecretKind = 'env' | 'header';

/** The keyring account of one env or header entry of a server. */
export function secretAccount(
  serviceId: string,
  server: Pick<McpServerConfig, 'serverId' | 'principal'>,
  kind: SecretKind,
  name: string,
): string {
  return keyringMcpSecretAccount(credentialIdentity(serviceId, server), kind, name);
}

/**
 * The keyring account of a server's OAuth client secret. Like every value of the server it sits
 * under the server's own account, so removing the server deletes it (server-store.ts `prune`).
 */
export function clientSecretAccount(
  serviceId: string,
  server: Pick<McpServerConfig, 'serverId' | 'principal'>,
): string {
  return `${keyringMcpAccount(credentialIdentity(serviceId, server))}:oauth-client-secret`;
}

/** The stored servers without touching the keyring: names, never values, for listings. */
export async function readStoredServers(dataDir: string): Promise<StoredServer[]> {
  try {
    const raw = JSON.parse(await readFile(serversFile(dataDir), 'utf8')) as unknown;
    return parse(ServerFileSchema, raw).servers;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw new Error('Saved MCP servers could not be read. The file is preserved.');
  }
}

export async function writeStoredServers(dataDir: string, servers: StoredServer[]): Promise<void> {
  await atomicWrite(serversFile(dataDir), { version: 1, servers });
  announceMcpChanged(dataDir);
}
