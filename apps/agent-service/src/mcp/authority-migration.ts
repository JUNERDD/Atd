import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { resolveHttpUrl } from './launch-resolve.js';
import type { McpConnectionStates } from './lifecycle.js';
import { migrateAdapterOAuth } from './oauth-migration.js';
import type { OAuthProviders } from './oauth-provider.js';
import type { McpServerRecords } from './server-records.js';

/**
 * The authority's start-up step for saved OAuth sign-ins: runs the one-time move of
 * pi-mcp-adapter's credentials into the service keychain (oauth-migration.ts) and shows what it
 * could not settle as connection states. It runs before any connection or sign-in is possible.
 *
 * A server whose sign-in exists but could not be moved, or could not be checked yet, reads
 * `auth_required` with the reason: nothing dials without its credentials and the user sees why. A
 * disabled server stays disabled and finds out when it is enabled and connected. A migration that
 * fails outright records nothing, so the next load tries again.
 */
export async function migrateSignIns(
  deps: { dataDir: string; log: Logger },
  records: McpServerRecords,
  providers: OAuthProviders,
  states: McpConnectionStates,
): Promise<void> {
  const outcomes = await migrateAdapterOAuth({
    dataDir: deps.dataDir,
    records: records.userRecords(),
    providers,
    resolveHttpUrl,
    log: deps.log,
  }).catch((error: unknown) => {
    deps.log.warn('MCP sign-ins of pi-mcp-adapter could not be checked; the next load retries.', {
      error: errorMessage(error),
    });
    return [];
  });
  for (const { serverId, result, detail } of outcomes) {
    if (result !== 'unmigratable' && result !== 'retry') continue;
    if (records.find(serverId)?.disabled) continue;
    states.set(serverId, 'auth_required', detail ?? '');
  }
}
