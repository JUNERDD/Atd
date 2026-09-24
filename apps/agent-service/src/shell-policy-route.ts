import type { FastifyInstance } from 'fastify';
import {
  parse,
  PutShellAllowlistRequestSchema,
  type PutShellAllowlistResponse,
} from '@ai/agent-contracts';
import type { Logger } from './logging.js';
import { setUserShellAllowlist, warnInvalidOperatorShellEntries } from './shell-policy.js';

/**
 * `PUT /v1/settings/shell-allowlist`: the desktop main process replaces the user shell allowlist
 * on every service connection and after every change. The list is held in memory only (the
 * desktop settings store persists it); the answer echoes the user list, never the operator's.
 */
export function registerShellAllowlistRoute(app: FastifyInstance, log: Logger): void {
  warnInvalidOperatorShellEntries(log);
  app.put('/v1/settings/shell-allowlist', async (request): Promise<PutShellAllowlistResponse> => {
    const body = parse(PutShellAllowlistRequestSchema, request.body);
    return { entries: setUserShellAllowlist(body.entries) };
  });
}
