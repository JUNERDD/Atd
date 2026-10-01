import type { FastifyInstance } from 'fastify';
import { Identifier, parse } from '@ai/agent-contracts';
import type { Ledger } from '../ledger.js';
import { ResourceStore } from '../resources.js';
import type { ServicePaths } from '../storage.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface ResourceRouteContext {
  ledger: Ledger;
  paths: ServicePaths;
}

const MIME = /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/;

/**
 * Resource download (T6b). Authenticated like every route; the store refuses
 * missing and orphaned task-scoped resources with 404. Bytes stream as
 * `application/octet-stream`-compatible bodies with the stored mime when it
 * is header-safe; filenames are sanitized for the disposition header.
 */
export function registerResourceRoutes(app: FastifyInstance, ctx: ResourceRouteContext): void {
  app.get<{ Params: { id: string } }>(
    '/v1/resources/:id',
    RENDERER_ROUTE,
    async (request, reply) => {
      const id = parse(Identifier, request.params.id);
      const store = new ResourceStore(ctx.ledger, ctx.paths);
      const { resource, bytes } = await store.readBytes(id);
      const mime = MIME.test(resource.mime) ? resource.mime : 'application/octet-stream';
      const filename = resource.name.replace(/["\r\n]/g, '_').slice(0, 200) || 'download.bin';
      reply.header('content-type', mime);
      reply.header(
        'content-disposition',
        `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(resource.name).slice(0, 200)}`,
      );
      return reply.send(Buffer.from(bytes));
    },
  );
}
