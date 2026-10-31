import type { FastifyInstance } from 'fastify';
import {
  Identifier,
  MAX_ATTACHMENT_BYTES,
  parse,
  type ResourceUploadResponse,
} from '@atd/agent-contracts';
import { authorize } from '../auth.js';
import type { ServiceConfig } from '../config.js';
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

export interface ResourceUploadContext {
  resources: ResourceStore;
  /** Read on every request, so the upload checks the token the service holds then. */
  config: Pick<ServiceConfig, 'token'>;
}

/**
 * `POST /v1/resources?name&mime`: bytes the renderer stores as a shared resource, such as pasted
 * text the composer turns into a file; they travel as the raw body. A pasted text may be as large
 * as any attachment, so the token is checked before the body is read, and only an authorized
 * client can make the service buffer one. The query's `mime` is only the client's claim: the
 * store keeps the type the content shows, else the name's (resources/media-type.ts).
 */
export function registerResourceUpload(app: FastifyInstance, ctx: ResourceUploadContext): void {
  app.post(
    '/v1/resources',
    {
      ...RENDERER_ROUTE,
      bodyLimit: MAX_ATTACHMENT_BYTES,
      onRequest: async (request) => authorize(request, ctx.config.token),
    },
    async (request): Promise<ResourceUploadResponse> => {
      const query = request.query as { name?: unknown; mime?: unknown };
      const name = typeof query.name === 'string' && query.name ? query.name : 'upload.bin';
      const mime =
        typeof query.mime === 'string' && query.mime ? query.mime : 'application/octet-stream';
      if (!Buffer.isBuffer(request.body)) throw new TypeError('Invalid data: body must be bytes.');
      // Stored as parsed: a copy would hold the upload in memory twice.
      return { resource: await ctx.resources.save({ name, mime, bytes: request.body }) };
    },
  );
}
