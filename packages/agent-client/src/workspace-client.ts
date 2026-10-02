import {
  parse,
  PatchSettingsRequestSchema,
  SettingsResponseSchema,
  type PatchSettingsRequest,
  type SettingsResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

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
