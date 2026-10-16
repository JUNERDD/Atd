import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import { parse } from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { announceInvalidation } from '../invalidate.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import type { ServerDeps } from '../server.js';
import { resolveAtdHome } from '../storage.js';
import { commitDevelopmentSync } from './commit.js';
import { planDevelopmentSync, type SyncProfile } from './plan.js';

const REQUEST = Type.Object({}, { additionalProperties: false });

/** Mounted only by the explicit development service; source paths never come from the page. */
export function registerDevelopmentRoutes(
  app: FastifyInstance,
  deps: Pick<ServerDeps, 'config' | 'settings' | 'manager'>,
  source: SyncProfile,
): void {
  let syncing = false;
  const writes = new Set<FastifyRequest>();
  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (syncing)
      throw new ConflictError('Development data is syncing. Try again when it finishes.');
    writes.add(request);
    // The response's `close` fires once it is sent and also when the client goes away first;
    // `onResponse` and `onRequestAbort` miss a client that leaves after its body was read.
    reply.raw.once('close', () => writes.delete(request));
  });
  app.post('/v1/development/sync', RENDERER_ROUTE, async (request) => {
    parse(REQUEST, request.body);
    if (syncing || writes.size !== 1)
      throw new ConflictError('Finish the other pending changes before syncing development data.');
    const resume = deps.manager.pauseForDataImport();
    syncing = true;
    try {
      const target = {
        dataDir: deps.config.paths.root,
        home: resolveAtdHome({ envHome: process.env.AI_ATD_HOME, dataDir: deps.config.paths.root }),
      };
      const plan = await planDevelopmentSync(source, target, deps.settings);
      const result = await commitDevelopmentSync(plan, deps.settings);
      for (const scope of ['settings', 'commands', 'extensions'] as const)
        announceInvalidation(request, { type: 'invalidate', scope });
      return result;
    } finally {
      syncing = false;
      resume();
    }
  });
}
