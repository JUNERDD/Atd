import {
  AddonListResponseSchema,
  AddonResponseSchema,
  WpsSelectionStatusSchema,
  parse,
  type AddonListResponse,
  type AddonResponse,
  type WpsSelectionStatus,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * The renderer's add-on routes (`/v1/addons`). Install and cancel answer at once; the outcome
 * arrives through the `addons` invalidation, and a view polls the list while a phase is running.
 */

const addonPath = (id: string, suffix = '') => `/v1/addons/${encodeURIComponent(id)}${suffix}`;

/** Connection status, without document or selection metadata. */
export function getWpsSelectionStatus(options: AgentClientOptions): Promise<WpsSelectionStatus> {
  return manageRequest(options, '/v1/integrations/wps-selection/status', 'GET', undefined, (json) =>
    parse(WpsSelectionStatusSchema, json),
  );
}

/** Retries local registration after WPS has created its profile or a setup error is resolved. */
export function reconnectWpsSelection(options: AgentClientOptions): Promise<WpsSelectionStatus> {
  return manageRequest(options, '/v1/integrations/wps-selection/reconnect', 'POST', {}, (json) =>
    parse(WpsSelectionStatusSchema, json),
  );
}

/** Every add-on this build knows, with its install state. */
export function getAddons(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<AddonListResponse> {
  return manageRequest(
    options,
    '/v1/addons',
    'GET',
    undefined,
    (json) => parse(AddonListResponseSchema, json),
    fetchImpl,
  );
}

/** Starts installing the archive this build pins (or joins the install already running). */
export function installAddon(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<AddonResponse> {
  return manageRequest(
    options,
    addonPath(id, '/install'),
    'POST',
    {},
    (json) => parse(AddonResponseSchema, json),
    fetchImpl,
  );
}

/** Cancels a running download or install; an active install stays. */
export function cancelAddon(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<AddonResponse> {
  return manageRequest(
    options,
    addonPath(id, '/cancel'),
    'POST',
    {},
    (json) => parse(AddonResponseSchema, json),
    fetchImpl,
  );
}

/** Removes the add-on's files; 409 (`inUse`) while a consumer still uses it. */
export function removeAddon(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<AddonResponse> {
  return manageRequest(
    options,
    addonPath(id),
    'DELETE',
    undefined,
    (json) => parse(AddonResponseSchema, json),
    fetchImpl,
  );
}
