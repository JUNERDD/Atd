import {
  parse,
  ResourceImportRequestSchema,
  ResourceImportResponseSchema,
  type ResourceImportRequest,
  type ResourceImportResponse,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * Shell only: creates resources from absolute paths the user picked, dropped or pasted. Each
 * path either imports or reports why not.
 */
export function importResources(
  options: AgentClientOptions,
  request: ResourceImportRequest,
  fetchImpl?: typeof fetch,
): Promise<ResourceImportResponse> {
  return manageRequest(
    options,
    '/v1/resources/import',
    'POST',
    parse(ResourceImportRequestSchema, request),
    (json) => parse(ResourceImportResponseSchema, json),
    fetchImpl,
  );
}
