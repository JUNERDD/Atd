import type { FastifyInstance } from 'fastify';
import {
  MemoryCreateRequestSchema,
  MemoryIdRequestSchema,
  MemorySaveRequestSchema,
  MemorySettingsRequestSchema,
  MemoryToggleRequestSchema,
  parse,
  type MemoryOkResponse,
  type MemoryProposalAcceptResponse,
  type MemorySettingsResponse,
  type MemoryStateResponse,
  type MemoryUnitResponse,
} from '@atd/agent-contracts';
import { announceInvalidation } from '../invalidate.js';
import type { Logger } from '../logging.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import { logMemoryEvents, MemoryAuthority } from './engine.js';

export interface MemoryUnitRouteContext {
  agentDir: string;
  log: Logger;
}

/**
 * The Memory settings routes over the skill-shaped memory authority (engine.ts), with the wire
 * contract of packages/agent-contracts/src/memory-units.ts. Every write is a renderer write the
 * `/v1/memory` invalidation prefix announces; an accepted skill suggestion also announces
 * `extensions`, since it created a Personal skill. A stale revision, a missing unit or suggestion
 * and a taken name answer 409; malformed input and blocked content answer 400.
 */
export function registerMemoryUnitRoutes(app: FastifyInstance, ctx: MemoryUnitRouteContext): void {
  const authority = () => MemoryAuthority.authorityFor(ctx.agentDir, logMemoryEvents(ctx.log));

  app.get('/v1/memory', RENDERER_ROUTE, async (): Promise<MemoryStateResponse> =>
    (await authority()).state(),
  );

  app.post(
    '/v1/memory/settings',
    RENDERER_ROUTE,
    async (request): Promise<MemorySettingsResponse> => {
      const body = parse(MemorySettingsRequestSchema, request.body);
      return (await authority()).setSettings(body);
    },
  );

  app.post('/v1/memory/create', RENDERER_ROUTE, async (request): Promise<MemoryUnitResponse> => {
    const body = parse(MemoryCreateRequestSchema, request.body);
    return (await authority()).create(body);
  });

  app.post('/v1/memory/save', RENDERER_ROUTE, async (request): Promise<MemoryUnitResponse> => {
    const body = parse(MemorySaveRequestSchema, request.body);
    return (await authority()).save(body);
  });

  app.post('/v1/memory/delete', RENDERER_ROUTE, async (request): Promise<MemoryOkResponse> => {
    const { id } = parse(MemoryIdRequestSchema, request.body);
    return (await authority()).delete(id);
  });

  app.post('/v1/memory/enable', RENDERER_ROUTE, async (request): Promise<MemoryOkResponse> => {
    const { id, enabled } = parse(MemoryToggleRequestSchema, request.body);
    return (await authority()).setEnabled(id, enabled);
  });

  app.post('/v1/memory/reviewed', RENDERER_ROUTE, async (request): Promise<MemoryOkResponse> => {
    const { id } = parse(MemoryIdRequestSchema, request.body);
    return (await authority()).markReviewed(id);
  });

  app.post(
    '/v1/memory/proposals/accept',
    RENDERER_ROUTE,
    async (request): Promise<MemoryProposalAcceptResponse> => {
      const { id } = parse(MemoryIdRequestSchema, request.body);
      const accepted = await (await authority()).acceptProposal(id);
      if (accepted.skill)
        announceInvalidation(request, { type: 'invalidate', scope: 'extensions' });
      return accepted;
    },
  );

  app.post(
    '/v1/memory/proposals/dismiss',
    RENDERER_ROUTE,
    async (request): Promise<MemoryOkResponse> => {
      const { id } = parse(MemoryIdRequestSchema, request.body);
      return (await authority()).dismissProposal(id);
    },
  );
}
