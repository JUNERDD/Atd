import {
  MemoryListResponseSchema,
  MemoryPauseRequestSchema,
  MemoryPauseResponseSchema,
  MemoryUpdateRequestSchema,
  MemoryUpdateResponseSchema,
  parse,
  type MemoryEntry,
  type MemoryListResponse,
  type MemoryPauseResponse,
  type MemoryUpdateResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** Lists memory entries with the pause flag and policy version. */
export function listMemory(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<MemoryListResponse> {
  return manageRequest(
    options,
    '/v1/memory',
    'GET',
    undefined,
    (json) => parse(MemoryListResponseSchema, json),
    fetchImpl,
  );
}

/** Pauses or resumes memory learning; bumps the policy version. */
export function pauseMemory(
  options: AgentClientOptions,
  paused: boolean,
  fetchImpl?: typeof fetch,
): Promise<MemoryPauseResponse> {
  return manageRequest(
    options,
    '/v1/memory/pause',
    'POST',
    parse(MemoryPauseRequestSchema, { paused }),
    (json) => parse(MemoryPauseResponseSchema, json),
    fetchImpl,
  );
}

/** Updates one memory entry's content. */
export function updateMemory(
  options: AgentClientOptions,
  entry: Pick<MemoryEntry, 'id' | 'target'>,
  content: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryUpdateResponse> {
  return manageRequest(
    options,
    '/v1/memory/update',
    'POST',
    parse(MemoryUpdateRequestSchema, { entry, content }),
    (json) => parse(MemoryUpdateResponseSchema, json),
    fetchImpl,
  );
}
