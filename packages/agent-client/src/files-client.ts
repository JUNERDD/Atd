import {
  FileAttachRequestSchema,
  FileAttachResponseSchema,
  FileSearchReplySchema,
  FileSearchRequestSchema,
  parse,
  ResourceImportRequestSchema,
  ResourceImportResponseSchema,
  type FileAttachRequest,
  type FileAttachResponse,
  type FileSearchReply,
  type FileSearchRequest,
  type ResourceImportRequest,
  type ResourceImportResponse,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * Searches file names below home. Replies carry opaque result ids and home-relative folders,
 * never paths; a newer search on the same channel answers the older one with `superseded`.
 */
export function searchFiles(
  options: AgentClientOptions,
  request: FileSearchRequest,
  fetchImpl?: typeof fetch,
): Promise<FileSearchReply> {
  return manageRequest(
    options,
    '/v1/files/search',
    'POST',
    parse(FileSearchRequestSchema, request),
    (json) => parse(FileSearchReplySchema, json),
    fetchImpl,
  );
}

/**
 * Creates resources from the files behind search result ids; the service reads the files
 * itself. Unknown or expired ids answer 410, a file that no longer passes the rules 409, and
 * nothing is stored unless every file passed.
 */
export function attachFileResults(
  options: AgentClientOptions,
  request: FileAttachRequest,
  fetchImpl?: typeof fetch,
): Promise<FileAttachResponse> {
  return manageRequest(
    options,
    '/v1/files/attach',
    'POST',
    parse(FileAttachRequestSchema, request),
    (json) => parse(FileAttachResponseSchema, json),
    fetchImpl,
  );
}

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
