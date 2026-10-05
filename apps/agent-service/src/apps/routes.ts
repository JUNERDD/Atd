import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  parse,
  PatchAppGrantsRequestSchema,
  PatchAppRequestSchema,
  RevertAppRequestSchema,
} from '@atd/agent-contracts';
import { invalidateOffRoute } from '../invalidate.js';
import { RENDERER_ROUTE } from '../relay-routes.js';
import { appRoute, AppFailure } from './errors.js';
import { clearAppData, deleteApp, editApp, revertApp } from './lifecycle.js';
import { appIdOf, registerAppRuntimeRoutes, type AppRequest } from './runtime-routes.js';
import { AppService, type AppServiceDeps } from './service.js';
import { listVersions } from './versions.js';

/**
 * The renderer's `/v1/apps` routes (DECISIONS "Service routes"), and the shell's runtime and
 * widget routes (runtime-routes.ts). The app service loads once per profile in the background;
 * routes wait for it. Changes reach clients as `apps` / `widgets` invalidates sent by the store
 * and the widget publisher, whoever made them (a route, the agent's tool, a backend), so no
 * route-prefix entry exists for them in invalidate.ts. On close, open streams end and every
 * backend stops before the server waits for its connections.
 */
export function registerAppRoutes(
  app: FastifyInstance,
  deps: Omit<AppServiceDeps, 'notify'>,
): void {
  const loading = AppService.create({ ...deps, notify: (frame) => invalidateOffRoute(app, frame) });
  loading.catch((error: unknown) =>
    deps.log.error('Apps could not be loaded.', { error: String(error) }),
  );
  const service = () => loading;
  const streams = registerAppRuntimeRoutes(app, service);
  app.addHook('preClose', async () => {
    for (const end of streams) end();
    await (await loading.catch(() => null))?.close();
  });

  app.get('/v1/apps', RENDERER_ROUTE, async () => (await service()).list());

  app.get(
    '/v1/apps/:appId',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) =>
      (await service()).detail(appIdOf(request)),
    ),
  );

  app.patch(
    '/v1/apps/:appId',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) => {
      const appId = appIdOf(request);
      const body = parse(PatchAppRequestSchema, request.body ?? {});
      return (await service()).rename(appId, body.name);
    }),
  );

  app.delete(
    '/v1/apps/:appId',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, reply: FastifyReply) => {
      await deleteApp(await service(), appIdOf(request));
      return reply.status(204).send();
    }),
  );

  app.get(
    '/v1/apps/:appId/versions',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) => {
      const apps = await service();
      const appId = appIdOf(request);
      apps.store.get(appId);
      return { versions: await listVersions(apps.paths, appId) };
    }),
  );

  app.post(
    '/v1/apps/:appId/revert',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) => {
      const appId = appIdOf(request);
      const body = parse(RevertAppRequestSchema, request.body);
      return revertApp(await service(), appId, body.version);
    }),
  );

  app.post(
    '/v1/apps/:appId/edit',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) =>
      editApp(await service(), appIdOf(request)),
    ),
  );

  app.patch(
    '/v1/apps/:appId/grants',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) => {
      const appId = appIdOf(request);
      const body = parse(PatchAppGrantsRequestSchema, request.body);
      return (await service()).setGrants(appId, body.grants);
    }),
  );

  app.post(
    '/v1/apps/:appId/clear-data',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, _reply: FastifyReply) =>
      clearAppData(await service(), appIdOf(request)),
    ),
  );

  app.get(
    '/v1/apps/:appId/icon',
    RENDERER_ROUTE,
    appRoute(async (request: AppRequest, reply: FastifyReply) => {
      const apps = await service();
      const appId = appIdOf(request);
      const { currentVersion } = apps.store.get(appId);
      const file = path.join(apps.paths.version(appId, currentVersion), 'icon.svg');
      const svg = await readFile(file).catch(() => null);
      if (!svg) throw new AppFailure(404, 'not_found', 'This version of the app has no icon.');
      // Agent-written SVG: shown as an image only, never as a document that runs scripts.
      return reply
        .header('content-type', 'image/svg+xml')
        .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'")
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-cache')
        .send(svg);
    }),
  );
}
