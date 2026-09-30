import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { oauthAccount } from '../dist/mcp/oauth-store.js';
import { serversFile } from '../dist/mcp/servers.js';
import { at, httpRecord } from './mcp-kit.ts';
import type { OAuthMock, SeededGrant } from './mcp-oauth-mock.ts';
import {
  adapterOAuthAccount,
  seedAdapterOAuth,
  type AdapterAuthEntry,
  type KeychainService,
} from './memory-keyring.ts';

/**
 * The world of the OAuth migration tests: one OAuth server per way a pi-mcp-adapter record can
 * turn out, the adapter's keychain seeded to match, and the items the service should end up with.
 * Every server shares the mock's MCP endpoint and differs by its query string.
 */

/** A long scope, so that a record is worth splitting into chunks. */
export const LONG_SCOPE = Array.from({ length: 150 }, (_, index) => `scope-${index}`).join(' ');

/** What the service says of a record it could not read. */
export const UNREADABLE = 'The saved sign-in could not be read; sign in again.';

const name = (kind: string) => `legacy-${kind}`;
/** Records the service moves in. */
export const MOVED = ['whole', 'chunked', 'stub', 'plain', 'envurl'].map(name);
/** Records that exist but cannot be used. */
export const UNREADABLE_IDS = ['garbled', 'shape', 'missing-chunk', 'bad-digest'].map(name);
/** Records that are not for the server they sit under. */
export const SKIPPED = ['mismatch', 'no-tokens', 'no-url', 'never-seen'].map(name);
export const PRESENT = name('present');
export const DISABLED = name('disabled');
export const ALL_IDS = [...MOVED, PRESENT, ...UNREADABLE_IDS, ...SKIPPED, DISABLED];

export interface LegacyWorld {
  grants: Record<string, SeededGrant>;
  /** The grant the adapter's record of `serverId` carries. */
  grant(serverId: string): SeededGrant;
  serverUrl(serverId: string): string;
  /** The keychain item the service should hold for a moved sign-in. */
  item(serverId: string, url?: string, extra?: { scope?: string; client?: boolean }): unknown;
}

interface Host {
  dataDir: string;
  serviceId: string;
}

/**
 * Writes `servers.json`, the adapter's records and the service's own sign-in of `legacy-present`.
 * Call it after the service started and before its first MCP use, which loads all of it.
 */
export async function seedLegacyWorld(
  host: Host,
  mock: OAuthMock,
  keyring: { set: (serviceId: string, account: string, value: string) => unknown },
  adapter: KeychainService,
): Promise<LegacyWorld> {
  const grants: Record<string, SeededGrant> = {};
  const grantOf = (serverId: string): SeededGrant => (grants[serverId] ??= mock.seedGrant());
  const serverUrl = (serverId: string) => `${mock.url}?s=${serverId}`;
  const tokensOf = (serverId: string, more: { scope?: string; issuer?: string } = {}) => {
    const grant = grantOf(serverId);
    return {
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      expiresAt: grant.expiresAt,
      ...more,
    };
  };
  const clientOf = (serverId: string) => {
    const grant = grantOf(serverId);
    return { clientId: grant.clientId, redirectUris: grant.redirectUris };
  };
  const entryFor = (serverId: string, extra: Partial<AdapterAuthEntry> = {}): AdapterAuthEntry => ({
    tokens: tokensOf(serverId),
    clientInfo: clientOf(serverId),
    serverUrl: serverUrl(serverId),
    ...extra,
  });
  const long = (serverId: string) =>
    entryFor(serverId, { tokens: tokensOf(serverId, { scope: LONG_SCOPE }) });
  const seed = (serverId: string, entry: AdapterAuthEntry | string, chunkSize?: number) =>
    seedAdapterOAuth(adapter, serverId, entry, chunkSize === undefined ? {} : { chunkSize });

  const servers = ALL_IDS.map((serverId) =>
    httpRecord(
      serverId,
      { disabled: serverId === DISABLED },
      {
        // The variable is filled in from the service environment when the URL is used.
        url:
          serverId === name('envurl')
            ? `${mock.url}?tag=\${AI_TEST_OAUTH_TAG}`
            : serverUrl(serverId),
        auth: { type: 'oauth', scope: null, redirectUri: null },
      },
    ),
  );
  const file = serversFile(host.dataDir);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ version: 1, servers }));

  seed(name('whole'), {
    ...entryFor(name('whole')),
    tokens: tokensOf(name('whole'), { issuer: 'https://issuer.example' }),
    codeVerifier: 'verifier-of-a-sign-in-in-progress',
    oauthState: 'state-of-a-sign-in-in-progress',
  });
  const chunked = seed(name('chunked'), long(name('chunked')), 1000);
  assert.ok(chunked.chunkAccounts.length >= 2, 'the record really is split');
  const stub = { clientId: 'from-config', configPreRegistered: true };
  seed(name('stub'), entryFor(name('stub'), { clientInfo: stub }));
  const plain = path.join(host.dataDir, 'mcp-oauth', adapterOAuthAccount(name('plain')));
  await mkdir(plain, { recursive: true });
  await writeFile(path.join(plain, 'tokens.json'), JSON.stringify(entryFor(name('plain'))));
  seed(name('envurl'), entryFor(name('envurl'), { serverUrl: `${mock.url}?tag=blue` }));

  // The service's own sign-in wins over whatever the adapter kept.
  seed(PRESENT, entryFor(PRESENT));
  const own = mock.seedGrant();
  const ownState = {
    serverUrl: serverUrl(PRESENT),
    tokens: {
      access_token: own.accessToken,
      token_type: 'Bearer',
      refresh_token: own.refreshToken,
    },
    tokensExpireAt: own.expiresAt * 1000,
    clientInformation: { client_id: own.clientId, redirect_uris: own.redirectUris },
  };
  const account = oauthAccount(host.serviceId, { serverId: PRESENT, principal: '' });
  keyring.set(host.serviceId, account, JSON.stringify({ v: 1, state: ownState }));

  seed(name('garbled'), '{"tokens":{"accessToken":"at-cut');
  seed(name('shape'), '{"tokens":"not an object"}');
  const missing = seed(name('missing-chunk'), long(name('missing-chunk')), 1000);
  adapter.remove(at(missing.chunkAccounts, 1));
  const altered = seed(name('bad-digest'), long(name('bad-digest')), 1000);
  adapter.set(at(altered.chunkAccounts), `x${adapter.get(at(altered.chunkAccounts)) ?? ''}`);
  seed(DISABLED, '{"tokens":');

  seed(name('mismatch'), entryFor(name('mismatch'), { serverUrl: `${mock.base}/elsewhere` }));
  seed(name('no-tokens'), {
    clientInfo: clientOf(name('no-tokens')),
    serverUrl: serverUrl(name('no-tokens')),
  });
  seed(name('no-url'), { tokens: tokensOf(name('no-url')) });

  return {
    grants,
    grant: grantOf,
    serverUrl,
    item: (serverId, url = serverUrl(serverId), extra = {}) => {
      const grant = grantOf(serverId);
      return {
        v: 1,
        state: {
          serverUrl: url,
          tokens: {
            access_token: grant.accessToken,
            token_type: 'Bearer',
            refresh_token: grant.refreshToken,
            ...(extra.scope ? { scope: extra.scope } : {}),
          },
          tokensExpireAt: grant.expiresAt * 1000,
          ...(extra.client === false
            ? {}
            : {
                clientInformation: { client_id: grant.clientId, redirect_uris: grant.redirectUris },
              }),
        },
      };
    },
  };
}
