import type { FastifyInstance } from 'fastify';
import {
  errorMessage,
  MemoryPauseRequestSchema,
  MemoryUpdateRequestSchema,
  parse,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { ConflictError } from '../errors.js';
import { logMemoryEvents, MemoryAuthority } from './authority.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface MemoryRouteContext {
  agentDir: string;
  log: Logger;
}

/**
 * Live memory routes (T6b) over the D7 authority singleton. Service-level
 * notify/changed events land in the log (logMemoryEvents); Hermes stays the
 * only store, so management reads and runner tools can never diverge.
 */
export function registerMemoryRoutes(app: FastifyInstance, ctx: MemoryRouteContext): void {
  const authority = () => MemoryAuthority.authorityFor(ctx.agentDir, logMemoryEvents(ctx.log));

  app.get('/v1/memory', RENDERER_ROUTE, async () => {
    const memory = await authority();
    return {
      entries: await memory.list().catch(mapHermesError),
      paused: memory.isPaused(),
      version: memory.currentPolicyVersion(),
    };
  });

  app.post('/v1/memory/pause', RENDERER_ROUTE, async (request) => {
    const body = parse(MemoryPauseRequestSchema, request.body);
    const memory = await authority();
    const version = await memory.setPaused(body.paused);
    return { paused: memory.isPaused(), version };
  });

  app.post('/v1/memory/update', RENDERER_ROUTE, async (request) => {
    const body = parse(MemoryUpdateRequestSchema, request.body);
    const memory = await authority();
    try {
      await memory.update(body.entry, body.content);
    } catch (error) {
      // Hermes reports a stale/missing entry as changed (observed against
      // the pinned host): a client-state conflict (409), not a server fault.
      const message = errorMessage(error);
      if (/changed/i.test(message)) throw new ConflictError(message);
      mapHermesError(error);
    }
    return { ok: true as const, version: memory.currentPolicyVersion() };
  });
}

/** Hermes failures stay honest 500s with the store message, never faked. */
function mapHermesError(error: unknown): never {
  throw new Error(`Memory store: ${errorMessage(error)}`);
}
