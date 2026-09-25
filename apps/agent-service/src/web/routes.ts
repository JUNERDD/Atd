import type { FastifyInstance } from 'fastify';
import {
  parse,
  WebSessionRequestSchema,
  type WebPairingResponse,
  type WebSessionResponse,
} from '@ai/agent-contracts';
import { AuthError } from '../auth.js';
import { presentedToken } from './access.js';
import type { WebSessions } from './sessions.js';

/**
 * Browser pairing: the owner mints a one-time code (`POST /v1/web/pairings`, owner-only through
 * the access check), the page exchanges it for a session token (`POST /v1/web/session`, public),
 * and `DELETE /v1/web/session` signs the calling browser out.
 */
export function registerWebRoutes(
  app: FastifyInstance,
  sessions: WebSessions,
  serviceId: string,
): void {
  app.post('/v1/web/pairings', async (): Promise<WebPairingResponse> => sessions.pair());

  app.post('/v1/web/session', async (request): Promise<WebSessionResponse> => {
    const { code } = parse(WebSessionRequestSchema, request.body);
    const session = await sessions.exchange(code);
    if (!session) throw new AuthError(401, 'This pairing link expired. Open a new one.');
    return { ...session, serviceId };
  });

  app.delete('/v1/web/session', async (request) => {
    const token = presentedToken(request);
    if (token) await sessions.revoke(token);
    return { ok: true };
  });
}
