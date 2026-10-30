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
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * How long a search may take. The service answers within its time budget unless a query that
 * already runs in the index outlasts it, so a reply this late means the service is stuck.
 */
const SEARCH_TIMEOUT_MS = 10_000;
/** How long an attach may take: it reads and stores up to ten files of up to 64 MiB each. */
const ATTACH_TIMEOUT_MS = 120_000;

/**
 * Searches file names below home. Replies carry opaque result ids and home-relative folders,
 * never paths; a newer search on the same channel answers the older one with `superseded`. A
 * search without a reply after `SEARCH_TIMEOUT_MS` rejects with a `TimeoutError`.
 */
export function searchFiles(
  options: AgentClientOptions,
  request: FileSearchRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<FileSearchReply> {
  return manageRequest(
    options,
    '/v1/files/search',
    'POST',
    parse(FileSearchRequestSchema, request),
    (json) => parse(FileSearchReplySchema, json),
    withTimeout(fetchImpl, SEARCH_TIMEOUT_MS),
  );
}

/**
 * Creates resources from the files behind search result ids; the service reads the files
 * itself. Unknown or expired ids answer 410, a file that no longer passes the rules 409, and
 * nothing is stored unless every file passed. An attach without a reply after
 * `ATTACH_TIMEOUT_MS` rejects with a `TimeoutError`.
 */
export function attachFileResults(
  options: AgentClientOptions,
  request: FileAttachRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<FileAttachResponse> {
  return manageRequest(
    options,
    '/v1/files/attach',
    'POST',
    parse(FileAttachRequestSchema, request),
    (json) => parse(FileAttachResponseSchema, json),
    withTimeout(fetchImpl, ATTACH_TIMEOUT_MS),
  );
}

/** `fetchImpl` whose request, body read included, aborts with a `TimeoutError` after `ms`. */
function withTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(ms) });
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
