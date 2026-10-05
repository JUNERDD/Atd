import {
  AppDetailSchema,
  AppListResponseSchema,
  AppVersionsResponseSchema,
  EditAppResponseSchema,
  parse,
  PatchAppGrantsRequestSchema,
  PatchAppRequestSchema,
  RevertAppRequestSchema,
  type AppDetail,
  type AppListResponse,
  type AppVersionsResponse,
  type EditAppResponse,
  type PatchAppGrantsRequest,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * The renderer's user-app routes (`/v1/apps`). The shell-only routes (runtime, API calls, events,
 * diagnostics, widgets) are served to the Swift shell and have no client here.
 */

const appPath = (appId: string, suffix = '') => `/v1/apps/${encodeURIComponent(appId)}${suffix}`;
const detail = (json: unknown): AppDetail => parse(AppDetailSchema, json);

/** Every app, most recently updated first, with the store revision. */
export function listApps(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<AppListResponse> {
  return manageRequest(
    options,
    '/v1/apps',
    'GET',
    undefined,
    (json) => parse(AppListResponseSchema, json),
    fetchImpl,
  );
}

export function getApp(
  options: AgentClientOptions,
  appId: string,
  fetchImpl?: typeof fetch,
): Promise<AppDetail> {
  return manageRequest(options, appPath(appId), 'GET', undefined, detail, fetchImpl);
}

export function renameApp(
  options: AgentClientOptions,
  appId: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<AppDetail> {
  return manageRequest(
    options,
    appPath(appId),
    'PATCH',
    parse(PatchAppRequestSchema, { name }),
    detail,
    fetchImpl,
  );
}

/** Stops the app's backend and deletes the app with every version and its data (204). */
export function deleteApp(
  options: AgentClientOptions,
  appId: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return manageRequest(options, appPath(appId), 'DELETE', undefined, () => undefined, fetchImpl);
}

/** The kept versions, newest first. */
export function listAppVersions(
  options: AgentClientOptions,
  appId: string,
  fetchImpl?: typeof fetch,
): Promise<AppVersionsResponse> {
  return manageRequest(
    options,
    appPath(appId, '/versions'),
    'GET',
    undefined,
    (json) => parse(AppVersionsResponseSchema, json),
    fetchImpl,
  );
}

/** Publishes a copy of `version` as the newest version; the app's data stays as it is. */
export function revertApp(
  options: AgentClientOptions,
  appId: string,
  version: number,
  fetchImpl?: typeof fetch,
): Promise<AppDetail> {
  return manageRequest(
    options,
    appPath(appId, '/revert'),
    'POST',
    parse(RevertAppRequestSchema, { version }),
    detail,
    fetchImpl,
  );
}

/** The task to continue editing in: the source task, or a new one restored from the latest source. */
export function editApp(
  options: AgentClientOptions,
  appId: string,
  fetchImpl?: typeof fetch,
): Promise<EditAppResponse> {
  return manageRequest(
    options,
    appPath(appId, '/edit'),
    'POST',
    {},
    (json) => parse(EditAppResponseSchema, json),
    fetchImpl,
  );
}

/**
 * Sets, or with `null` forgets, capability consents. Answering a pending consent
 * (`AppSummary.consents`) is this call with `granted` or `denied` for its capability.
 */
export function patchAppGrants(
  options: AgentClientOptions,
  appId: string,
  grants: PatchAppGrantsRequest['grants'],
  fetchImpl?: typeof fetch,
): Promise<AppDetail> {
  return manageRequest(
    options,
    appPath(appId, '/grants'),
    'PATCH',
    parse(PatchAppGrantsRequestSchema, { grants }),
    detail,
    fetchImpl,
  );
}

/**
 * Resets the app's backend data: the service stops the app's backend and empties its data
 * directory. The renderer pairs it with the shell's `userApp.clearData` for the web storage.
 */
export function clearAppData(
  options: AgentClientOptions,
  appId: string,
  fetchImpl?: typeof fetch,
): Promise<AppDetail> {
  return manageRequest(options, appPath(appId, '/clear-data'), 'POST', {}, detail, fetchImpl);
}

/**
 * URL of the app's current icon (`image/svg+xml`) for an `<img>`; a relay host adds the
 * credential. The icon changes with versions, so pass `currentVersion` to key the browser cache
 * on it.
 */
export function appIconUrl(options: AgentClientOptions, appId: string, version?: number): string {
  const query = version === undefined ? '' : `?v=${version}`;
  return `${options.baseUrl}${appPath(appId, '/icon')}${query}`;
}
