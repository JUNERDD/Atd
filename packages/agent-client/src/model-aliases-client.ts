import {
  ModelAliasCreateRequestSchema,
  ModelAliasDefaultRequestSchema,
  ModelAliasDefaultResponseSchema,
  ModelAliasMutationResponseSchema,
  ModelAliasRemoveResponseSchema,
  ModelAliasesSeedRequestSchema,
  ModelAliasesSeedResponseSchema,
  ModelAliasUpdateRequestSchema,
  parse,
  type ModelAliasCreateRequest,
  type ModelAliasDefaultResponse,
  type ModelAliasDraft,
  type ModelAliasMutationResponse,
  type ModelAliasRemoveResponse,
  type ModelAliasesSeedResponse,
  type ModelAliasUpdateRequest,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** Creates one named model alias on the service and returns the updated alias list. */
export function createModelAlias(
  options: AgentClientOptions,
  draft: ModelAliasCreateRequest,
  fetchImpl?: typeof fetch,
): Promise<ModelAliasMutationResponse> {
  return manageRequest(
    options,
    '/v1/providers/aliases',
    'POST',
    parse(ModelAliasCreateRequestSchema, draft),
    (json) => parse(ModelAliasMutationResponseSchema, json),
    fetchImpl,
  );
}

/** Replaces an existing named model alias and returns the updated alias list. */
export function updateModelAlias(
  options: AgentClientOptions,
  aliasId: string,
  draft: ModelAliasUpdateRequest,
  fetchImpl?: typeof fetch,
): Promise<ModelAliasMutationResponse> {
  return manageRequest(
    options,
    `/v1/providers/aliases/${encodeURIComponent(aliasId)}`,
    'PUT',
    parse(ModelAliasUpdateRequestSchema, draft),
    (json) => parse(ModelAliasMutationResponseSchema, json),
    fetchImpl,
  );
}

/** Deletes a saved model alias and returns the remaining aliases and default id. */
export function removeModelAlias(
  options: AgentClientOptions,
  aliasId: string,
  fetchImpl?: typeof fetch,
): Promise<ModelAliasRemoveResponse> {
  return manageRequest(
    options,
    `/v1/providers/aliases/${encodeURIComponent(aliasId)}`,
    'DELETE',
    undefined,
    (json) => parse(ModelAliasRemoveResponseSchema, json),
    fetchImpl,
  );
}

/** Sets or clears (`null`) the default model alias used as fallback when no explicit model applies. */
export function setDefaultModelAlias(
  options: AgentClientOptions,
  defaultAliasId: string | null,
  fetchImpl?: typeof fetch,
): Promise<ModelAliasDefaultResponse> {
  return manageRequest(
    options,
    '/v1/providers/aliases/default',
    'PUT',
    parse(ModelAliasDefaultRequestSchema, { defaultAliasId }),
    (json) => parse(ModelAliasDefaultResponseSchema, json),
    fetchImpl,
  );
}

/** Seeds starter model aliases up to the alias cap without changing `defaultAliasId`. */
export function seedModelAliases(
  options: AgentClientOptions,
  aliases: readonly ModelAliasDraft[],
  fetchImpl?: typeof fetch,
): Promise<ModelAliasesSeedResponse> {
  return manageRequest(
    options,
    '/v1/providers/aliases/seed',
    'POST',
    parse(ModelAliasesSeedRequestSchema, { aliases: [...aliases] }),
    (json) => parse(ModelAliasesSeedResponseSchema, json),
    fetchImpl,
  );
}
