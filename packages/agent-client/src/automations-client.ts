import {
  AutomationDraftSchema,
  AutomationItemSchema,
  AutomationListResponseSchema,
  AutomationRunsResponseSchema,
  AutomationSettingsSchema,
  MarkAutomationRunsReadRequestSchema,
  parse,
  PreviewAutomationTriggerRequestSchema,
  PreviewAutomationTriggerResponseSchema,
  RunAutomationResponseSchema,
  SetAutomationEnabledRequestSchema,
  UpdateAutomationRequestSchema,
  type AutomationDraft,
  type AutomationItem,
  type AutomationListResponse,
  type AutomationRunsResponse,
  type AutomationSettings,
  type MarkAutomationRunsReadRequest,
  type PreviewAutomationTriggerRequest,
  type PreviewAutomationTriggerResponse,
  type RunAutomationResponse,
  type SetAutomationEnabledRequest,
  type UpdateAutomationRequest,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * The renderer's automation routes (`/v1/automations`, `/v1/automation-runs`,
 * `/v1/automation-settings`). The notice routes (`/v1/automation-notices`) serve the Swift shell
 * only and have no client here. Requests are checked before they leave and answers on arrival.
 */

const automationPath = (id: string, suffix = '') =>
  `/v1/automations/${encodeURIComponent(id)}${suffix}`;
const item = (json: unknown): AutomationItem => parse(AutomationItemSchema, json);

/** Every automation with its live status, the global pause, and a store problem if any. */
export function listAutomations(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<AutomationListResponse> {
  return manageRequest(
    options,
    '/v1/automations',
    'GET',
    undefined,
    (json) => parse(AutomationListResponseSchema, json),
    fetchImpl,
  );
}

export function getAutomation(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<AutomationItem> {
  return manageRequest(options, automationPath(id), 'GET', undefined, item, fetchImpl);
}

/** Saves a new automation (201); a trigger the service cannot use answers 400 naming why. */
export function createAutomation(
  options: AgentClientOptions,
  draft: AutomationDraft,
  fetchImpl?: typeof fetch,
): Promise<AutomationItem> {
  return manageRequest(
    options,
    '/v1/automations',
    'POST',
    parse(AutomationDraftSchema, draft),
    item,
    fetchImpl,
  );
}

/** Replaces an automation; 409 when `expectedRevision` is no longer the stored one. */
export function updateAutomation(
  options: AgentClientOptions,
  id: string,
  body: UpdateAutomationRequest,
  fetchImpl?: typeof fetch,
): Promise<AutomationItem> {
  return manageRequest(
    options,
    automationPath(id),
    'PUT',
    parse(UpdateAutomationRequestSchema, body),
    item,
    fetchImpl,
  );
}

/** Turns an automation on or off; turning it on clears the pause the service set. */
export function setAutomationEnabled(
  options: AgentClientOptions,
  id: string,
  body: SetAutomationEnabledRequest,
  fetchImpl?: typeof fetch,
): Promise<AutomationItem> {
  return manageRequest(
    options,
    automationPath(id),
    'PATCH',
    parse(SetAutomationEnabledRequestSchema, body),
    item,
    fetchImpl,
  );
}

/** Deletes an automation and its run history (204); the tasks it started stay. */
export function deleteAutomation(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return manageRequest(
    options,
    automationPath(id),
    'DELETE',
    undefined,
    () => undefined,
    fetchImpl,
  );
}

/** Run now: the run record it started. A run already in progress answers 409. */
export function runAutomation(
  options: AgentClientOptions,
  id: string,
  fetchImpl?: typeof fetch,
): Promise<RunAutomationResponse> {
  return manageRequest(
    options,
    automationPath(id, '/run'),
    'POST',
    {},
    (json) => parse(RunAutomationResponseSchema, json),
    fetchImpl,
  );
}

/** The automation's run records, newest first; `limit` caps how many. */
export function listAutomationRuns(
  options: AgentClientOptions,
  id: string,
  limit?: number,
  fetchImpl?: typeof fetch,
): Promise<AutomationRunsResponse> {
  const query = limit === undefined ? '' : `?limit=${limit}`;
  return manageRequest(
    options,
    automationPath(id, `/runs${query}`),
    'GET',
    undefined,
    (json) => parse(AutomationRunsResponseSchema, json),
    fetchImpl,
  );
}

/** The next run times of a trigger being edited, or the problem that keeps it from running. */
export function previewAutomationTrigger(
  options: AgentClientOptions,
  body: PreviewAutomationTriggerRequest,
  fetchImpl?: typeof fetch,
): Promise<PreviewAutomationTriggerResponse> {
  return manageRequest(
    options,
    '/v1/automations/preview',
    'POST',
    parse(PreviewAutomationTriggerRequestSchema, body),
    (json) => parse(PreviewAutomationTriggerResponseSchema, json),
    fetchImpl,
  );
}

/** Marks run results opened, by run or by the task a run started (204); unknown ids are ignored. */
export function markAutomationRunsRead(
  options: AgentClientOptions,
  body: MarkAutomationRunsReadRequest,
  fetchImpl?: typeof fetch,
): Promise<void> {
  return manageRequest(
    options,
    '/v1/automation-runs/read',
    'POST',
    parse(MarkAutomationRunsReadRequestSchema, body),
    () => undefined,
    fetchImpl,
  );
}

/** Sets the global pause, which stops every automation from firing on its own. */
export function patchAutomationSettings(
  options: AgentClientOptions,
  body: AutomationSettings,
  fetchImpl?: typeof fetch,
): Promise<AutomationSettings> {
  return manageRequest(
    options,
    '/v1/automation-settings',
    'PATCH',
    parse(AutomationSettingsSchema, body),
    (json) => parse(AutomationSettingsSchema, json),
    fetchImpl,
  );
}
