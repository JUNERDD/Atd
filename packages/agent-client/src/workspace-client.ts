import {
  parse,
  PatchSettingsRequestSchema,
  SettingsResponseSchema,
  WebPairingResponseSchema,
  WebSessionResponseSchema,
  type PatchSettingsRequest,
  type SettingsResponse,
  type WebPairingResponse,
  type WebSessionResponse,
} from '@ai/agent-contracts';
import { Type } from 'typebox';
import { manageRequest, toClientError } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

const OkSchema = Type.Object({ ok: Type.Boolean() });

/** The shared user settings and whether any client has written them yet. */
export function getSettings(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<SettingsResponse> {
  return manageRequest(
    options,
    '/v1/settings',
    'GET',
    undefined,
    (json) => parse(SettingsResponseSchema, json),
    fetchImpl,
  );
}

/** Replaces the listed settings; every connected client receives a `settings` invalidation. */
export function patchSettings(
  options: AgentClientOptions,
  request: PatchSettingsRequest,
  fetchImpl?: typeof fetch,
): Promise<SettingsResponse> {
  return manageRequest(
    options,
    '/v1/settings',
    'PATCH',
    parse(PatchSettingsRequestSchema, request),
    (json) => parse(SettingsResponseSchema, json),
    fetchImpl,
  );
}

/** Owner token only: a one-time code a browser exchanges for its own session. */
export function createWebPairing(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<WebPairingResponse> {
  return manageRequest(
    options,
    '/v1/web/pairings',
    'POST',
    undefined,
    (json) => parse(WebPairingResponseSchema, json),
    fetchImpl,
  );
}

/** Exchanges a pairing code for a browser session token; needs no prior credential. */
export async function exchangeWebPairing(
  baseUrl: string,
  code: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<WebSessionResponse> {
  const response = await fetchImpl(`${baseUrl}/v1/web/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  return parse(WebSessionResponseSchema, json);
}

/** Signs the calling browser session out. */
export function revokeWebSession(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean }> {
  return manageRequest(
    options,
    '/v1/web/session',
    'DELETE',
    undefined,
    (json) => parse(OkSchema, json),
    fetchImpl,
  );
}
