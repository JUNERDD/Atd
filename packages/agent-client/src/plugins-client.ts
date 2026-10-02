import {
  PluginDetailSchema,
  PluginDuplicateResponseSchema,
  PluginInstallPreviewSchema,
  PluginListResponseSchema,
  parse,
  type PluginConfigRequest,
  type PluginDetail,
  type PluginDuplicateResponse,
  type PluginInstallPreview,
  type PluginItemKind,
  type PluginListResponse,
  type PluginPreviewRequest,
} from '@atd/agent-contracts';
import { Type } from 'typebox';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * Plugin management over `/v1/plugins` (routes in `agent-contracts/src/plugins.ts`). Plugin ids
 * contain `:` (`builtin:core`, `shared:agents-skills`), so every path segment is URL-encoded.
 * Responses are validated against the contract schemas.
 */

const RemovedSchema = Type.Object({ removed: Type.Literal(true) }, { additionalProperties: false });

const pluginPath = (id: string) => `/v1/plugins/${encodeURIComponent(id)}`;
const itemPath = (id: string, kind: PluginItemKind, name: string) =>
  `${pluginPath(id)}/items/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`;
const detail = (json: unknown) => parse(PluginDetailSchema, json);

/** Every host and installed plugin with its contents counts and diagnostics. */
export function listPlugins(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<PluginListResponse> {
  return manageRequest(
    options,
    '/v1/plugins',
    'GET',
    undefined,
    (json) => parse(PluginListResponseSchema, json),
    fetchImpl,
  );
}

/** One plugin with its items, manifest and user config (sensitive values only as set/unset). */
export function getPlugin(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<PluginDetail> {
  return manageRequest(options, pluginPath(id), 'GET', undefined, detail, fetchImpl);
}

/** Turns a toggleable plugin on or off; its items follow from the next run. */
export function setPluginEnabled(
  options: AgentClientOptions,
  id: string,
  enabled: boolean,
  fetchImpl?: typeof fetch,
): Promise<PluginDetail> {
  return manageRequest(
    options,
    `${pluginPath(id)}/enabled`,
    'POST',
    { enabled },
    detail,
    fetchImpl,
  );
}

/** Turns one item of a plugin on or off; `name` is the item's name inside the plugin. */
export function setPluginItemEnabled(
  options: AgentClientOptions,
  input: { id: string; kind: PluginItemKind; name: string; enabled: boolean },
  fetchImpl?: typeof fetch,
): Promise<PluginDetail> {
  return manageRequest(
    options,
    `${itemPath(input.id, input.kind, input.name)}/enabled`,
    'POST',
    { enabled: input.enabled },
    detail,
    fetchImpl,
  );
}

/** Saves user config values; `null` clears one. */
export function configurePlugin(
  options: AgentClientOptions,
  id: string,
  values: PluginConfigRequest['values'],
  fetchImpl?: typeof fetch,
): Promise<PluginDetail> {
  return manageRequest(options, `${pluginPath(id)}/config`, 'PUT', { values }, detail, fetchImpl);
}

/** Copies a read-only plugin item into Personal; answers the copy's kind and name. */
export function duplicatePluginItem(
  options: AgentClientOptions,
  input: { id: string; kind: PluginItemKind; name: string },
  fetchImpl?: typeof fetch,
): Promise<PluginDuplicateResponse> {
  return manageRequest(
    options,
    `${itemPath(input.id, input.kind, input.name)}/duplicate`,
    'POST',
    {},
    (json) => parse(PluginDuplicateResponseSchema, json),
    fetchImpl,
  );
}

/** Fetches a bundle into staging and answers what installing it would add; nothing runs. */
export function previewPlugin(
  options: AgentClientOptions,
  source: PluginPreviewRequest['source'],
  fetchImpl?: typeof fetch,
): Promise<PluginInstallPreview> {
  return manageRequest(
    options,
    '/v1/plugins/preview',
    'POST',
    { source },
    (json) => parse(PluginInstallPreviewSchema, json),
    fetchImpl,
  );
}

/** Re-fetches an installed plugin's recorded source; installing the preview updates it. */
export function previewPluginUpdate(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<PluginInstallPreview> {
  return manageRequest(
    options,
    `${pluginPath(id)}/update/preview`,
    'POST',
    {},
    (json) => parse(PluginInstallPreviewSchema, json),
    fetchImpl,
  );
}

/** Publishes a previewed bundle. A new plugin lands disabled; an update keeps its state. */
export function installPlugin(
  options: AgentClientOptions,
  previewId: string,
  fetchImpl?: typeof fetch,
): Promise<PluginDetail> {
  return manageRequest(options, '/v1/plugins/install', 'POST', { previewId }, detail, fetchImpl);
}

/** Removes an installed plugin with its data and secrets. */
export function uninstallPlugin(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<{ removed: true }> {
  return manageRequest(
    options,
    pluginPath(id),
    'DELETE',
    undefined,
    (json) => parse(RemovedSchema, json),
    fetchImpl,
  );
}
