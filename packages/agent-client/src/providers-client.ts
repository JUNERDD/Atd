import {
  parse,
  ProviderConnectRequestSchema,
  ProviderConnectResponseSchema,
  ProviderCreateRequestSchema,
  ProviderDisconnectRequestSchema,
  ProviderDisconnectResponseSchema,
  ProviderGetResponseSchema,
  ProvidersCatalogResponseSchema,
  ProvidersListResponseSchema,
  ProviderStatusResponseSchema,
  type ProviderConnectRequest,
  type ProviderConnectResponse,
  type ProviderCreateRequest,
  type ProviderDisconnectResponse,
  type ProviderGetResponse,
  type ProvidersCatalogResponse,
  type ProvidersListResponse,
  type ProviderStatusResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/** Lists secret-free provider connections with the current default. */
export function listProviders(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<ProvidersListResponse> {
  return manageRequest(
    options,
    '/v1/providers',
    'GET',
    undefined,
    (json) => parse(ProvidersListResponseSchema, json),
    fetchImpl,
  );
}

/** Reads one secret-free provider connection. */
export function getProvider(
  options: AgentClientOptions,
  connectionId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderGetResponse> {
  return manageRequest(
    options,
    `/v1/providers/${encodeURIComponent(connectionId)}`,
    'GET',
    undefined,
    (json) => parse(ProviderGetResponseSchema, json),
    fetchImpl,
  );
}

/** Local-only provider health: keyring probe + credential check, no network. */
export function providerStatus(
  options: AgentClientOptions,
  connectionId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderStatusResponse> {
  return manageRequest(
    options,
    `/v1/providers/${encodeURIComponent(connectionId)}/status`,
    'GET',
    undefined,
    (json) => parse(ProviderStatusResponseSchema, json),
    fetchImpl,
  );
}

/**
 * Creates a connection and stores its credential in one request; the service
 * owns the id, revision and configurationId. Resolves with the same outcome
 * connect returns, because creating is the first connect.
 */
export function createProvider(
  options: AgentClientOptions,
  body: ProviderCreateRequest,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectResponse> {
  return manageRequest(
    options,
    '/v1/providers',
    'POST',
    parse(ProviderCreateRequestSchema, body),
    (json) => parse(ProviderConnectResponseSchema, json),
    fetchImpl,
  );
}

/** Provisions a credential for a connection (persists to the OS keyring). */
export function connectProvider(
  options: AgentClientOptions,
  connectionId: string,
  body: ProviderConnectRequest,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectResponse> {
  return manageRequest(
    options,
    `/v1/providers/${encodeURIComponent(connectionId)}/connect`,
    'POST',
    parse(ProviderConnectRequestSchema, body),
    (json) => parse(ProviderConnectResponseSchema, json),
    fetchImpl,
  );
}

/** Deletes a connection credential; revision-guarded. */
export function disconnectProvider(
  options: AgentClientOptions,
  connectionId: string,
  expectedRevision: number,
  fetchImpl?: typeof fetch,
): Promise<ProviderDisconnectResponse> {
  return manageRequest(
    options,
    `/v1/providers/${encodeURIComponent(connectionId)}/disconnect`,
    'POST',
    parse(ProviderDisconnectRequestSchema, { expectedRevision }),
    (json) => parse(ProviderDisconnectResponseSchema, json),
    fetchImpl,
  );
}

/** Service-owned provider catalog: Pi providers plus local entries. */
export function listCatalog(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<ProvidersCatalogResponse> {
  return manageRequest(
    options,
    '/v1/providers/catalog',
    'GET',
    undefined,
    (json) => parse(ProvidersCatalogResponseSchema, json),
    fetchImpl,
  );
}
