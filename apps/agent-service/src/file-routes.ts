import type { FastifyInstance } from 'fastify';
import {
  parse,
  ResourceImportRequestSchema,
  type ResourceImportResponse,
} from '@ai/agent-contracts';
import type { ResourceStore } from './resources.js';
import { importResources } from './resources/import.js';
import type { RouteExposure } from './route-exposure.js';

export interface FileRouteDeps {
  resources: ResourceStore;
}

const shell: { exposure: RouteExposure } = { exposure: 'shell' };

/**
 * Files from the user's disk becoming resources. Import takes absolute paths, so only the shell
 * may call it.
 */
export function registerFileRoutes(app: FastifyInstance, deps: FileRouteDeps): void {
  app.post('/v1/resources/import', { config: shell }, async (request) => {
    const { paths } = parse(ResourceImportRequestSchema, request.body);
    return (await importResources(deps.resources, paths)) satisfies ResourceImportResponse;
  });
}
