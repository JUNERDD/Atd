import { homedir } from 'node:os';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  errorMessage,
  FileAttachRequestSchema,
  FileSearchRequestSchema,
  parse,
  ResourceImportRequestSchema,
  type ErrorCode,
  type FileAttachResponse,
  type FileSearchReply,
  type ResourceImportResponse,
} from '@ai/agent-contracts';
import { platformBackend } from './file-search/backend.js';
import { AttachRefused, FileSearchService, SearchResultGone } from './file-search/service.js';
import type { ResourceStore } from './resources.js';
import { AttachableRejected } from './resources/attachable-read.js';
import { importResources } from './resources/import.js';
import type { RouteExposure } from './route-exposure.js';

export interface FileRouteDeps {
  resources: ResourceStore;
}

const renderer: { exposure: RouteExposure } = { exposure: 'renderer' };
const shell: { exposure: RouteExposure } = { exposure: 'shell' };

/**
 * Files from the user's disk becoming resources. Search and attach-by-result-id serve the
 * renderer: it sees names, home-relative folders and opaque ids, never paths, and attach reads
 * only files a search issued. Import takes absolute paths, so only the shell may call it.
 */
export function registerFileRoutes(app: FastifyInstance, deps: FileRouteDeps): void {
  const search = new FileSearchService(
    () => platformBackend(process.platform),
    deps.resources,
    homedir(),
    process.platform,
  );
  app.addHook('onClose', () => search.close());

  app.post('/v1/files/search', { config: renderer }, async (request, reply) => {
    const { channel, ...query } = parse(FileSearchRequestSchema, request.body);
    try {
      return (await search.search(channel, query)) satisfies FileSearchReply;
    } catch (error) {
      // FileSearchService replaces backend failures with a message that carries no path.
      return refuse(reply, 500, 'internal', errorMessage(error));
    }
  });

  app.post('/v1/files/attach', { config: renderer }, async (request, reply) => {
    const { channel, resultIds } = parse(FileAttachRequestSchema, request.body);
    try {
      return { resources: await search.attach(channel, resultIds) } satisfies FileAttachResponse;
    } catch (error) {
      if (error instanceof SearchResultGone) return refuse(reply, 410, 'gone', error.message);
      // The file changed since the search: it no longer passes the rules or the scope.
      if (error instanceof AttachRefused || error instanceof AttachableRejected)
        return refuse(reply, 409, 'conflict', error.message);
      throw error;
    }
  });

  app.post('/v1/resources/import', { config: shell }, async (request) => {
    const { paths } = parse(ResourceImportRequestSchema, request.body);
    return (await importResources(deps.resources, paths)) satisfies ResourceImportResponse;
  });
}

function refuse(reply: FastifyReply, status: number, code: ErrorCode, message: string) {
  return reply.status(status).send({ error: { code, message } });
}
