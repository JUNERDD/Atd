import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from '@atd/agent-contracts';
import type { McpOAuthState } from '@earendil-works/pi-mcp/oauth';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { readKeyringItem } from '../credentials/keyring.js';
import { LEGACY_ADAPTER_CHUNK_MARKER, LEGACY_ADAPTER_OAUTH_SERVICE } from './constants.js';

/**
 * Reading and mapping the OAuth credentials pi-mcp-adapter 3.1.0 left (mcp-auth.ts): a compact
 * JSON `AuthEntry` per server, in the OS keychain service `pi-mcp-adapter.oauth` under the
 * account `sha256-<hex of the connection name>`, or, when the platform limits a value's size,
 * a manifest naming chunk items. Older adapters kept the same JSON in a plaintext `tokens.json`.
 * This module only reads; nothing of the adapter's is ever written or deleted.
 */

const LegacyEntrySchema = Type.Object({
  tokens: Type.Optional(
    Type.Object({
      accessToken: Type.String(),
      refreshToken: Type.Optional(Type.String()),
      /** Unix seconds, possibly fractional. */
      expiresAt: Type.Optional(Type.Number()),
      scope: Type.Optional(Type.String()),
      issuer: Type.Optional(Type.String()),
    }),
  ),
  clientInfo: Type.Optional(
    Type.Object({
      clientId: Type.String(),
      clientSecret: Type.Optional(Type.String()),
      clientIdIssuedAt: Type.Optional(Type.Number()),
      clientSecretExpiresAt: Type.Optional(Type.Number()),
      redirectUris: Type.Optional(Type.Array(Type.String())),
      issuer: Type.Optional(Type.String()),
      /** A stub for a client the adapter's config supplied; never standalone client information. */
      configPreRegistered: Type.Optional(Type.Boolean()),
    }),
  ),
  codeVerifier: Type.Optional(Type.String()),
  oauthState: Type.Optional(Type.String()),
  /** The URL the credentials were issued for; the adapter used them for no other. */
  serverUrl: Type.Optional(Type.String()),
});

export type LegacyAuthEntry = Static<typeof LegacyEntrySchema>;

/** What replaces the record when it is split into chunk items (the adapter chunks on Windows). */
const ManifestSchema = Type.Object({
  [LEGACY_ADAPTER_CHUNK_MARKER]: Type.Literal(1),
  chunkCount: Type.Integer({ minimum: 1, maximum: 1000 }),
  chunkDigest: Type.String({ pattern: '^[a-f0-9]{16}$' }),
});

export type LegacyRead =
  | { found: false }
  | { found: true; entry: LegacyAuthEntry }
  /** Something is stored but cannot be used; `malformed` says why, without quoting it. */
  | { found: true; malformed: string };

/** The adapter's account for a connection name: `sha256-<hex of the name>`. */
export function legacyAccount(serverId: string): string {
  return `sha256-${createHash('sha256').update(serverId, 'utf8').digest('hex')}`;
}

/**
 * The adapter's record of a base server name: its keychain item (whole, or the chunks a manifest
 * names, verified against the manifest's digest), else the plaintext file under `legacyDir`. A
 * keychain that cannot be read throws `KeyringUnavailable`.
 */
export async function readLegacyEntry(serverId: string, legacyDir: string): Promise<LegacyRead> {
  const account = legacyAccount(serverId);
  const stored = await readKeyringItem(LEGACY_ADAPTER_OAUTH_SERVICE, account);
  if (stored !== undefined) {
    const payload = await assemble(account, stored);
    return 'malformed' in payload ? { found: true, ...payload } : decode(payload.text);
  }
  try {
    return decode(await readFile(path.join(legacyDir, account, 'tokens.json'), 'utf8'));
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { found: false };
    return { found: true, malformed: 'the plaintext file cannot be read' };
  }
}

/** The record's JSON text: the stored value itself, or the joined and verified chunks. */
async function assemble(
  account: string,
  stored: string,
): Promise<{ text: string } | { malformed: string }> {
  let json: unknown;
  try {
    json = JSON.parse(stored);
  } catch {
    return { malformed: 'the record is not JSON' };
  }
  if (!Value.Check(ManifestSchema, json)) return { text: stored };
  const parts: string[] = [];
  for (let index = 0; index < json.chunkCount; index += 1) {
    const chunk = `${account}.chunk.${json.chunkDigest}.${index}`;
    const part = await readKeyringItem(LEGACY_ADAPTER_OAUTH_SERVICE, chunk);
    if (part === undefined) return { malformed: `chunk ${index} is missing` };
    parts.push(part);
  }
  const text = parts.join('');
  const digest = createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
  return digest === json.chunkDigest ? { text } : { malformed: 'the chunks fail their digest' };
}

function decode(text: string): LegacyRead {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { found: true, malformed: 'the record is not JSON' };
  }
  try {
    return { found: true, entry: parse(LegacyEntrySchema, json) };
  } catch {
    return { found: true, malformed: 'the record has an unexpected shape' };
  }
}

/**
 * The same sign-in in pi-mcp's shape (`serverUrl` is the normalized URL pi-mcp keys state by).
 * Dropped: `issuer` (pi-mcp validates the authorization server's issuer at discovery), a sign-in
 * in progress (`codeVerifier`, `oauthState`; an adapter flow did not survive a restart either),
 * and a `configPreRegistered` client stub. Discovery is absent and found again at the first
 * refresh.
 */
export function toMcpOAuthState(entry: LegacyAuthEntry, serverUrl: string): McpOAuthState {
  const state: McpOAuthState = { serverUrl };
  const { tokens, clientInfo } = entry;
  if (tokens) {
    state.tokens = {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      ...(tokens.refreshToken !== undefined ? { refresh_token: tokens.refreshToken } : {}),
      ...(tokens.scope !== undefined ? { scope: tokens.scope } : {}),
    };
    if (tokens.expiresAt !== undefined) state.tokensExpireAt = Math.round(tokens.expiresAt * 1000);
  }
  if (clientInfo && !clientInfo.configPreRegistered) {
    state.clientInformation = {
      client_id: clientInfo.clientId,
      ...(clientInfo.clientSecret !== undefined ? { client_secret: clientInfo.clientSecret } : {}),
      ...(clientInfo.clientIdIssuedAt !== undefined
        ? { client_id_issued_at: clientInfo.clientIdIssuedAt }
        : {}),
      ...(clientInfo.clientSecretExpiresAt !== undefined
        ? { client_secret_expires_at: clientInfo.clientSecretExpiresAt }
        : {}),
      ...(clientInfo.redirectUris !== undefined
        ? { redirect_uris: [...clientInfo.redirectUris] }
        : {}),
    };
  }
  return state;
}
