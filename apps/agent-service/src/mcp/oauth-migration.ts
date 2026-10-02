import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { errorMessage, parse, type McpServerConfig } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { atomicWrite } from '../config.js';
import type { Logger } from '../logging.js';
import { LEGACY_ADAPTER_OAUTH_DIR, MCP_OAUTH_MIGRATION_FILE } from './constants.js';
import { securityDir } from './launch-store.js';
import { readLegacyEntry, toMcpOAuthState } from './oauth-legacy.js';
import type { OAuthProviders } from './oauth-provider.js';
import { oauthServerUrl } from './oauth-store.js';
import type { OAuthMigrationOutcome, ResolveHttpUrl } from './types.js';

/**
 * The one-time move of pi-mcp-adapter's OAuth credentials into the service keychain, run when the
 * MCP authority is assembled (before any connection or sign-in is possible). It reads the
 * adapter's keychain item (or plaintext file) and writes the service's own; it never deletes or
 * changes anything of the adapter's, which the pi CLI may share, and never overwrites a state the
 * service wrote.
 *
 * The import is one pass per data dir: the first run decides every OAuth server that exists then,
 * and writes a marker in `security/` (which the agent's file tools cannot write) even when there is
 * none. A server listed there is never read from the adapter again, so a logout is final; one that
 * could not be read (`retry`) is tried again at each load. A server the marker does not list was
 * added later, and the adapter's keychain service is not read for it: it is shared with the pi CLI
 * and would hand over another product's grant. A marker that cannot be read fails closed: nothing
 * is imported and it is not rewritten.
 */

const RecordedSchema = Type.Object({
  result: Type.Union([
    Type.Literal('migrated'),
    Type.Literal('present'),
    Type.Literal('none'),
    Type.Literal('unmigratable'),
    Type.Literal('retry'),
  ]),
  detail: Type.Optional(Type.String()),
  at: Type.String(),
});

const MarkerSchema = Type.Object({
  version: Type.Literal(1),
  servers: Type.Record(Type.String(), RecordedSchema),
});

type Recorded = Static<typeof RecordedSchema>;

const UNREADABLE = 'The saved sign-in could not be read; sign in again.';
const UNVERIFIED = 'The saved sign-in could not be moved; sign in again.';

export interface MigrationDeps {
  dataDir: string;
  records: readonly McpServerConfig[];
  providers: OAuthProviders;
  resolveHttpUrl: ResolveHttpUrl;
  log: Logger;
}

/**
 * Migrates the OAuth servers, one after the other: at the first pass all of them, later only those
 * recorded as `retry`. The result has an outcome per server decided now, and again each
 * `unmigratable` one whose service entry is still empty, so the caller can show "sign in again"
 * (`auth_required` with the detail).
 */
export async function migrateAdapterOAuth(deps: MigrationDeps): Promise<OAuthMigrationOutcome[]> {
  const file = path.join(securityDir(deps.dataDir), MCP_OAUTH_MIGRATION_FILE);
  const marker = await readMarker(file);
  if (!marker) {
    deps.log.warn('The MCP OAuth migration record could not be read; no credentials are imported.');
    return [];
  }
  const legacyDir =
    process.env.MCP_OAUTH_DIR?.trim() || path.join(deps.dataDir, LEGACY_ADAPTER_OAUTH_DIR);
  const outcomes: OAuthMigrationOutcome[] = [];
  const decided = new Map<string, Recorded>();
  for (const record of deps.records) {
    if (record.http?.auth.type !== 'oauth') continue;
    const { serverId } = record;
    const known = marker.servers.get(serverId);
    if (known?.result === 'unmigratable') {
      const pending = await stillEmpty(deps, record, known.detail);
      if (pending) outcomes.push(pending);
      continue;
    }
    if (known && known.result !== 'retry') continue;
    // A server the first pass did not see was added after the import: nothing is read for it.
    const outcome: OAuthMigrationOutcome =
      marker.first || known
        ? await migrateOne(deps, record, legacyDir)
        : { serverId, result: 'none' };
    outcomes.push(outcome);
    if (known && outcome.result === 'retry') continue; // still the recorded state
    decided.set(serverId, {
      result: outcome.result,
      // A retry's detail is an error text: it is shown now, never kept.
      ...(outcome.result === 'unmigratable' && outcome.detail ? { detail: outcome.detail } : {}),
      at: new Date().toISOString(),
    });
  }
  if (marker.first || decided.size > 0) {
    try {
      await atomicWrite(file, {
        version: 1,
        servers: Object.fromEntries([...marker.servers, ...decided]),
      });
    } catch (error) {
      deps.log.warn('The MCP OAuth migration record could not be written.', {
        error: errorMessage(error),
      });
    }
  }
  if (outcomes.length > 0) {
    const summary = outcomes.map(({ serverId, result }) => ({ serverId, result }));
    deps.log.info('MCP OAuth credentials of pi-mcp-adapter were checked.', { outcomes: summary });
  }
  return outcomes;
}

/** The recorded decisions, and whether this is the first pass; null when the marker cannot be used. */
async function readMarker(
  file: string,
): Promise<{ servers: Map<string, Recorded>; first: boolean } | null> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    return code === 'ENOENT' ? { servers: new Map(), first: true } : null;
  }
  try {
    const { servers } = parse(MarkerSchema, JSON.parse(raw));
    return { servers: new Map(Object.entries(servers)), first: false };
  } catch {
    return null;
  }
}

/** A server recorded as `unmigratable` stays visible until the user signs in again. */
async function stillEmpty(
  deps: MigrationDeps,
  record: McpServerConfig,
  detail: string | undefined,
): Promise<OAuthMigrationOutcome | null> {
  const { serverId } = record;
  try {
    if (await deps.providers.storeFor(record).load()) return null;
    return { serverId, result: 'unmigratable', detail: detail ?? UNREADABLE };
  } catch (error) {
    return { serverId, result: 'retry', detail: errorMessage(error) };
  }
}

/** Decides one server, in the order of the contract; a failure to read or write is a `retry`. */
async function migrateOne(
  deps: MigrationDeps,
  record: McpServerConfig,
  legacyDir: string,
): Promise<OAuthMigrationOutcome> {
  const { serverId } = record;
  const outcome = (result: OAuthMigrationOutcome['result'], detail?: string) => ({
    serverId,
    result,
    ...(detail ? { detail } : {}),
  });
  try {
    const store = deps.providers.storeFor(record);
    if (await store.load()) return outcome('present');
    const resolved = deps.resolveHttpUrl(record);
    const read = await readLegacyEntry(serverId, legacyDir);
    if (!read.found) return outcome('none');
    if ('malformed' in read) {
      deps.log.warn('The saved sign-in of pi-mcp-adapter cannot be used.', {
        serverId,
        reason: read.malformed,
      });
      return outcome('unmigratable', UNREADABLE);
    }
    const { entry } = read;
    // Credentials belong to the URL they were issued for, compared as the adapter did: as written
    // or with its env references filled in.
    const issuedFor = entry.serverUrl;
    if (!entry.tokens || (issuedFor !== record.http?.url && issuedFor !== resolved)) {
      return outcome('none');
    }
    const state = toMcpOAuthState(entry, oauthServerUrl(resolved));
    await store.save(state);
    // A new store instance reads the keychain itself, so this compares what was persisted.
    deps.providers.forget(serverId);
    const stored = await deps.providers.storeFor(record).load();
    return isDeepStrictEqual(stored, JSON.parse(JSON.stringify(state)))
      ? outcome('migrated')
      : outcome('unmigratable', UNVERIFIED);
  } catch (error) {
    deps.providers.forget(serverId);
    return outcome('retry', errorMessage(error));
  }
}
