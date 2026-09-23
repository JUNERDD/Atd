import {
  parse,
  ProviderConnectionResponseSchema,
  ProviderDefaultRequestSchema,
  ProviderDefaultResponseSchema,
  ProviderLoginAnswerRequestSchema,
  ProviderLevelsQuerySchema,
  ProviderLevelsResponseSchema,
  ProviderLoginResponseSchema,
  ProviderModelRequestSchema,
  ProviderUpdateRequestSchema,
  ProviderVerifyRequestSchema,
  type ProviderConnectionResponse,
  type ProviderDefaultResponse,
  type ProviderLevelsResponse,
  type ProviderLoginResponse,
  type ProviderUpdateRequest,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

const connectionPath = (connectionId: string, action = '') =>
  `/v1/providers/${encodeURIComponent(connectionId)}${action}`;
const loginPath = (loginId: string, action = '') =>
  `/v1/providers/logins/${encodeURIComponent(loginId)}${action}`;
const decodeConnection = (json: unknown) => parse(ProviderConnectionResponseSchema, json);
const decodeLogin = (json: unknown) => parse(ProviderLoginResponseSchema, json);

/** Replaces a connection's editable configuration; revision-guarded. */
export function updateProvider(
  options: AgentClientOptions,
  connectionId: string,
  body: ProviderUpdateRequest,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectionResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId),
    'PUT',
    parse(ProviderUpdateRequestSchema, body),
    decodeConnection,
    fetchImpl,
  );
}

/** Makes one connection the default for runs; revision-guarded. */
export function setDefaultProvider(
  options: AgentClientOptions,
  connectionId: string,
  expectedRevision: number,
  fetchImpl?: typeof fetch,
): Promise<ProviderDefaultResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId, '/default'),
    'POST',
    parse(ProviderDefaultRequestSchema, { expectedRevision }),
    (json) => parse(ProviderDefaultResponseSchema, json),
    fetchImpl,
  );
}

/** Sets a connection's default model from its catalog; revision-guarded. */
export function setProviderModel(
  options: AgentClientOptions,
  connectionId: string,
  modelId: string,
  expectedRevision: number,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectionResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId, '/model'),
    'POST',
    parse(ProviderModelRequestSchema, { expectedRevision, modelId }),
    decodeConnection,
    fetchImpl,
  );
}

/** Refreshes a connection's model catalog over the network. */
export function refreshProvider(
  options: AgentClientOptions,
  connectionId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectionResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId, '/refresh'),
    'POST',
    undefined,
    decodeConnection,
    fetchImpl,
  );
}

/** Sends one small model request to prove access; may use provider credits. */
export function verifyProvider(
  options: AgentClientOptions,
  connectionId: string,
  modelId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderConnectionResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId, '/verify'),
    'POST',
    parse(ProviderVerifyRequestSchema, { modelId }),
    decodeConnection,
    fetchImpl,
  );
}

/** The thinking levels one of the connection's models accepts; empty when unknown. */
export function getProviderLevels(
  options: AgentClientOptions,
  connectionId: string,
  modelId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderLevelsResponse> {
  const query = new URLSearchParams(parse(ProviderLevelsQuerySchema, { modelId }));
  return manageRequest(
    options,
    connectionPath(connectionId, `/levels?${query}`),
    'GET',
    undefined,
    (json) => parse(ProviderLevelsResponseSchema, json),
    fetchImpl,
  );
}

/** Starts account sign-in for an OAuth connection. */
export function startProviderLogin(
  options: AgentClientOptions,
  connectionId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderLoginResponse> {
  return manageRequest(
    options,
    connectionPath(connectionId, '/login'),
    'POST',
    undefined,
    decodeLogin,
    fetchImpl,
  );
}

/** Reads sign-in progress; poll while the state is `waiting`. */
export function getProviderLogin(
  options: AgentClientOptions,
  loginId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderLoginResponse> {
  return manageRequest(options, loginPath(loginId), 'GET', undefined, decodeLogin, fetchImpl);
}

/** Answers the sign-in prompt the state currently shows. */
export function answerProviderLogin(
  options: AgentClientOptions,
  loginId: string,
  promptId: string,
  value: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderLoginResponse> {
  return manageRequest(
    options,
    loginPath(loginId, '/answer'),
    'POST',
    parse(ProviderLoginAnswerRequestSchema, { promptId, value }),
    decodeLogin,
    fetchImpl,
  );
}

/** Cancels a pending sign-in; finished sign-ins are returned unchanged. */
export function cancelProviderLogin(
  options: AgentClientOptions,
  loginId: string,
  fetchImpl?: typeof fetch,
): Promise<ProviderLoginResponse> {
  return manageRequest(
    options,
    loginPath(loginId, '/cancel'),
    'POST',
    undefined,
    decodeLogin,
    fetchImpl,
  );
}
