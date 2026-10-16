import type { FastifyInstance } from 'fastify';
import {
  errorMessage,
  parse,
  PatchSettingsRequestSchema,
  PutShellAllowlistRequestSchema,
  type PutShellAllowlistResponse,
  type SettingsResponse,
} from '@atd/agent-contracts';
import { assertSettingsShortcutsFree } from '../commands/shortcuts.js';
import { syncStarterCommands } from '../commands/starters.js';
import { CommandStore } from '../commands/store.js';
import type { Logger } from '../logging.js';
import { warnInvalidOperatorShellEntries } from '../shell-policy.js';
import { effectiveLanguage } from './language.js';
import type { SettingsStore } from './store.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

/**
 * `GET/PATCH /v1/settings`: the shared user settings. `PUT /v1/settings/shell-allowlist` stays for
 * clients that replace only the allowlist; it writes through the same store, so the list persists
 * and every client sees it. Neither answer echoes the operator's `AI_AGENT_SHELL_ALLOWLIST`.
 * A PATCH that changes an application shortcut to keys a saved command's shortcut or the selection
 * toolbar's double-tap holds, or the toolbar's double-tap to one an application shortcut or a
 * saved command's shortcut holds, answers 409. A PATCH that changes the language the clients show brings the starter
 * commands the user never saved into it (`syncStarterCommands`).
 */
export function registerSettingsRoutes(
  app: FastifyInstance,
  settings: SettingsStore,
  dataDir: string,
  log: Logger,
): void {
  warnInvalidOperatorShellEntries(log);
  app.get('/v1/settings', RENDERER_ROUTE, async (): Promise<SettingsResponse> =>
    settings.current(),
  );
  app.patch('/v1/settings', RENDERER_ROUTE, async (request): Promise<SettingsResponse> => {
    const before = settings.current().settings.language;
    const response = await settings.patch(
      parse(PatchSettingsRequestSchema, request.body),
      async (next, previous) =>
        assertSettingsShortcutsFree(next, previous, (await CommandStore.load(dataDir)).list()),
    );
    const { language } = response.settings;
    if (language !== before) {
      // The setting is saved either way; the starters catch up at the next start.
      await syncStarterCommands(dataDir, await effectiveLanguage(language)).catch(
        (error: unknown) =>
          log.warn('The starter commands did not follow the language change.', {
            error: errorMessage(error),
          }),
      );
    }
    return response;
  });
  app.put(
    '/v1/settings/shell-allowlist',
    RENDERER_ROUTE,
    async (request): Promise<PutShellAllowlistResponse> => {
      const body = parse(PutShellAllowlistRequestSchema, request.body);
      const next = await settings.replaceShellAllowlist(body.entries);
      return { entries: next.settings.shellAllowlist };
    },
  );
}
