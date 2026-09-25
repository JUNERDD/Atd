import type { FastifyRequest } from 'fastify';
import { STREAM_AUTH_PROTOCOL_PREFIX } from '@ai/agent-contracts';
import { AuthError, bearerMatches } from '../auth.js';
import type { WebSessions } from './sessions.js';

/** `owner` holds the service token (desktop, CLI); `browser` holds a paired web session. */
export type Caller = 'owner' | 'browser';

/** Routes a browser session may not call: they mint access, stop the service or import secrets. */
const OWNER_ONLY = [/^\/v1\/admin\//, /^\/v1\/web\/pairings$/, /^\/v1\/migration\//];

function pathname(request: FastifyRequest): string {
  return new URL(request.url, 'http://service.invalid').pathname;
}

/**
 * Requests that carry no credential by design: the page and its assets (anything outside `/v1`),
 * and the pairing-code exchange that issues the first browser credential.
 */
export function isPublic(request: FastifyRequest): boolean {
  const path = pathname(request);
  if (!path.startsWith('/v1/')) return request.method === 'GET' || request.method === 'HEAD';
  return request.method === 'POST' && path === '/v1/web/session';
}

/**
 * The credential a request presents. HTTP clients send `Authorization: Bearer`; browsers cannot
 * set headers on a WebSocket, so the stream upgrade may carry it as the subprotocol
 * `ai.auth.<token>` instead. The service never selects that subprotocol, so it is not echoed.
 */
export function presentedToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);
  const offered = request.headers['sec-websocket-protocol'];
  if (typeof offered !== 'string') return null;
  const auth = offered
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.startsWith(STREAM_AUTH_PROTOCOL_PREFIX));
  return auth ? auth.slice(STREAM_AUTH_PROTOCOL_PREFIX.length) : null;
}

/** Resolves who is calling or throws the 401/403 the error handler maps. */
export function authorize(request: FastifyRequest, token: string, sessions: WebSessions): Caller {
  const presented = presentedToken(request);
  if (presented && bearerMatches(`Bearer ${presented}`, token)) return 'owner';
  if (!presented || !sessions.verify(presented))
    throw new AuthError(401, 'Valid bearer authorization is required.');
  if (OWNER_ONLY.some((pattern) => pattern.test(pathname(request))))
    throw new AuthError(403, 'This action needs the desktop app.');
  return 'browser';
}
