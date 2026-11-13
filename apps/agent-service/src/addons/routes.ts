import type { FastifyInstance } from 'fastify';
import type { AddonListResponse, AddonResponse } from '@atd/agent-contracts';
import { invalidateOffRoute } from '../invalidate.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import type { AddonRegistry } from './registry.js';
import type { SettingsStore } from '../settings/store.js';
import { registerWpsSelectionRoutes } from '../wps-selection/bridge.js';

type IdParams = { Params: { id: string } };

/**
 * The add-on management routes (design §9) are `renderer` routes: the page manages add-ons through the
 * relay, and the shell, a direct main-token client that may call every route, reads the list to
 * resolve engine paths. Install and cancel answer with the add-on's view; their outcome arrives
 * through the `addons` invalidation (invalidate.ts announces each route write, the registry's
 * listener every change made off a route). An unknown id is 404; an add-on this build does not
 * offer (install) or one a consumer still uses (removal) is 409, with the reason in its view.
 */
export function registerAddonRoutes(
  app: FastifyInstance,
  deps: { addons: AddonRegistry; settings: SettingsStore; dataDir: string },
): void {
  const { addons } = deps;
  registerWpsSelectionRoutes(app, deps);
  const stop = addons.onChange(() =>
    invalidateOffRoute(app, { type: 'invalidate', scope: 'addons' }),
  );
  app.addHook('onClose', async () => {
    stop();
  });

  app.get('/v1/addons', RENDERER_ROUTE, async (): Promise<AddonListResponse> => ({
    addons: addons.list(),
  }));

  app.post<IdParams>(
    '/v1/addons/:id/install',
    RENDERER_ROUTE,
    async (request): Promise<AddonResponse> => ({ addon: addons.install(request.params.id) }),
  );

  app.post<IdParams>(
    '/v1/addons/:id/cancel',
    RENDERER_ROUTE,
    async (request): Promise<AddonResponse> => ({ addon: await addons.cancel(request.params.id) }),
  );

  app.delete<IdParams>(
    '/v1/addons/:id',
    RENDERER_ROUTE,
    async (request): Promise<AddonResponse> => ({ addon: await addons.remove(request.params.id) }),
  );
}
