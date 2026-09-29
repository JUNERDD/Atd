import type { FastifyInstance } from 'fastify';
import {
  parse,
  PatchSettingsRequestSchema,
  PutShellAllowlistRequestSchema,
  type PutShellAllowlistResponse,
  type SettingsResponse,
} from '@ai/agent-contracts';
import { assertAppShortcutsFree } from '../commands/shortcuts.js';
import { CommandStore } from '../commands/store.js';
import type { Logger } from '../logging.js';
import { warnInvalidOperatorShellEntries } from '../shell-policy.js';
import type { SettingsStore } from './store.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

/**
 * `GET/PATCH /v1/settings`: the shared user settings. `PUT /v1/settings/shell-allowlist` stays for
 * clients that replace only the allowlist; it writes through the same store, so the list persists
 * and every client sees it. Neither answer echoes the operator's `AI_AGENT_SHELL_ALLOWLIST`.
 * A PATCH that changes an application shortcut to one a saved command holds answers 409.
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
  app.patch('/v1/settings', RENDERER_ROUTE, async (request): Promise<SettingsResponse> =>
    settings.patch(parse(PatchSettingsRequestSchema, request.body), async (next, previous) =>
      assertAppShortcutsFree(next, previous, (await CommandStore.load(dataDir)).list()),
    ),
  );
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
