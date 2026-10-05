import {
  MemoryCreateRequestSchema,
  MemoryIdRequestSchema,
  MemoryOkResponseSchema,
  MemoryProposalAcceptResponseSchema,
  MemorySaveRequestSchema,
  MemorySettingsRequestSchema,
  MemorySettingsResponseSchema,
  MemoryStateResponseSchema,
  MemoryToggleRequestSchema,
  MemoryUnitResponseSchema,
  parse,
  type MemoryCreateRequest,
  type MemoryOkResponse,
  type MemoryProposalAcceptResponse,
  type MemorySaveRequest,
  type MemorySettingsRequest,
  type MemorySettingsResponse,
  type MemoryStateResponse,
  type MemoryUnitResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** Every memory unit, pending proposals and the learning settings. */
export function readMemoryState(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<MemoryStateResponse> {
  return manageRequest(
    options,
    '/v1/memory',
    'GET',
    undefined,
    (json) => parse(MemoryStateResponseSchema, json),
    fetchImpl,
  );
}

/** Pauses or resumes learning, or turns Ask before saving on or off. */
export function saveMemorySettings(
  options: AgentClientOptions,
  settings: MemorySettingsRequest,
  fetchImpl?: typeof fetch,
): Promise<MemorySettingsResponse> {
  return manageRequest(
    options,
    '/v1/memory/settings',
    'POST',
    parse(MemorySettingsRequestSchema, settings),
    (json) => parse(MemorySettingsResponseSchema, json),
    fetchImpl,
  );
}

/** Creates one unit written in Settings. */
export function createMemoryUnit(
  options: AgentClientOptions,
  input: MemoryCreateRequest,
  fetchImpl?: typeof fetch,
): Promise<MemoryUnitResponse> {
  return manageRequest(
    options,
    '/v1/memory/create',
    'POST',
    parse(MemoryCreateRequestSchema, input),
    (json) => parse(MemoryUnitResponseSchema, json),
    fetchImpl,
  );
}

/** Saves changed fields of one unit; a stale revision is refused with 409. */
export function saveMemoryUnit(
  options: AgentClientOptions,
  input: MemorySaveRequest,
  fetchImpl?: typeof fetch,
): Promise<MemoryUnitResponse> {
  return manageRequest(
    options,
    '/v1/memory/save',
    'POST',
    parse(MemorySaveRequestSchema, input),
    (json) => parse(MemoryUnitResponseSchema, json),
    fetchImpl,
  );
}

/** Moves one unit to the memory trash. */
export function deleteMemoryUnit(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryOkResponse> {
  return idRequest(options, '/v1/memory/delete', id, fetchImpl);
}

/** Turns one unit on or off for runs. */
export function toggleMemoryUnit(
  options: AgentClientOptions,
  id: string,
  enabled: boolean,
  fetchImpl?: typeof fetch,
): Promise<MemoryOkResponse> {
  return manageRequest(
    options,
    '/v1/memory/enable',
    'POST',
    parse(MemoryToggleRequestSchema, { id, enabled }),
    (json) => parse(MemoryOkResponseSchema, json),
    fetchImpl,
  );
}

/** Clears a learned unit's New badge once the user has opened it. */
export function markMemoryUnitReviewed(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryOkResponse> {
  return idRequest(options, '/v1/memory/reviewed', id, fetchImpl);
}

/** Applies one proposal; a `skill` proposal creates that Personal skill and names it. */
export function acceptMemoryProposal(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryProposalAcceptResponse> {
  return manageRequest(
    options,
    '/v1/memory/proposals/accept',
    'POST',
    parse(MemoryIdRequestSchema, { id }),
    (json) => parse(MemoryProposalAcceptResponseSchema, json),
    fetchImpl,
  );
}

/** Drops one proposal without applying it. */
export function dismissMemoryProposal(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryOkResponse> {
  return idRequest(options, '/v1/memory/proposals/dismiss', id, fetchImpl);
}

function idRequest(
  options: AgentClientOptions,
  path: string,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<MemoryOkResponse> {
  return manageRequest(
    options,
    path,
    'POST',
    parse(MemoryIdRequestSchema, { id }),
    (json) => parse(MemoryOkResponseSchema, json),
    fetchImpl,
  );
}
