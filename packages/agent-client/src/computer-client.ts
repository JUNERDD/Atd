import { Type, type Static } from 'typebox';
import {
  ComputerProgressSchema,
  ComputerResolveFactsRequestSchema,
  ComputerResolveFactsResponseSchema,
  ComputerStatusResponseSchema,
  ComputerTrialRequestSchema,
  ComputerTrialResponseSchema,
  ComputerUnresolvedFactsResponseSchema,
  DeleteComputerBindingResponseSchema,
  parse,
  ResolveComputerHoldRequestSchema,
  ResolveComputerHoldResponseSchema,
  StopAllComputerResponseSchema,
  type ComputerResolveFactsRequest,
  type ComputerResolveFactsResponse,
  type ComputerStatusResponse,
  type ComputerTrialRequest,
  type ComputerTrialResponse,
  type ComputerUnresolvedFactsResponse,
  type DeleteComputerBindingResponse,
  type ResolveComputerHoldRequest,
  type ResolveComputerHoldResponse,
  type StopAllComputerResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { AgentClientOptions } from './types.js';

/**
 * The renderer's computer routes (`/v1/computer`, and the computer trial and hold routes of an
 * automation). Binding content and grants are written only by the shell's own routes, so nothing
 * here can register a target or authorize an automation. Requests are checked before they leave
 * and answers on arrival.
 */

/**
 * GET `/v1/computer/progress?taskId=`: the latest live progress of each run of the task, which a
 * view reads when it opens or reconnects; later frames arrive on the stream (`computer.progress`).
 */
export const ComputerProgressListSchema = Type.Object(
  { progress: Type.Array(ComputerProgressSchema, { maxItems: 100 }) },
  { additionalProperties: false },
);
export type ComputerProgressList = Static<typeof ComputerProgressListSchema>;

const automationPath = (id: string, suffix: string) =>
  `/v1/automations/${encodeURIComponent(id)}${suffix}`;

/**
 * A person checked what these actions of the task did: the service appends a person resolution to
 * each one that existed, belonged to the task and was still unresolved, and answers those.
 */
export function resolveComputerFacts(
  options: AgentClientOptions,
  body: ComputerResolveFactsRequest,
  fetchImpl?: typeof fetch,
): Promise<ComputerResolveFactsResponse> {
  return manageRequest(
    options,
    '/v1/computer/facts/resolve',
    'POST',
    parse(ComputerResolveFactsRequestSchema, body),
    (json) => parse(ComputerResolveFactsResponseSchema, json),
    fetchImpl,
  );
}

/**
 * GET `/v1/computer/facts/unresolved?taskId=`: the task's actions that still await a person's
 * check, across all of its runs (reads excluded), which a view reads to offer "mark as checked"
 * only where it can still take effect.
 */
export function getUnresolvedComputerFacts(
  options: AgentClientOptions,
  taskId: string,
  fetchImpl?: typeof fetch,
): Promise<ComputerUnresolvedFactsResponse> {
  return manageRequest(
    options,
    `/v1/computer/facts/unresolved?taskId=${encodeURIComponent(taskId)}`,
    'GET',
    undefined,
    (json) => parse(ComputerUnresolvedFactsResponseSchema, json),
    fetchImpl,
  );
}

/** The computer host, the registered targets and which of them a run is acting on. */
export function getComputerStatus(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<ComputerStatusResponse> {
  return manageRequest(
    options,
    '/v1/computer',
    'GET',
    undefined,
    (json) => parse(ComputerStatusResponseSchema, json),
    fetchImpl,
  );
}

/**
 * Disconnects a target: every automation authorized for it needs authorizing again, and the host
 * lets its handles go. The managed browser profile's sign-in data stays.
 */
export function deleteComputerBinding(
  options: AgentClientOptions,
  bindingId: string,
  fetchImpl?: typeof fetch,
): Promise<DeleteComputerBindingResponse> {
  return manageRequest(
    options,
    `/v1/computer/bindings/${encodeURIComponent(bindingId)}`,
    'DELETE',
    undefined,
    (json) => parse(DeleteComputerBindingResponseSchema, json),
    fetchImpl,
  );
}

/** Stops the computer work of every run, attended or not. */
export function stopAllComputer(
  options: AgentClientOptions,
  fetchImpl?: typeof fetch,
): Promise<StopAllComputerResponse> {
  return manageRequest(
    options,
    '/v1/computer/stop-all',
    'POST',
    {},
    (json) => parse(StopAllComputerResponseSchema, json),
    fetchImpl,
  );
}

/** The latest progress of each of the task's runs (see `ComputerProgressListSchema`). */
export function getComputerProgress(
  options: AgentClientOptions,
  taskId: string,
  fetchImpl?: typeof fetch,
): Promise<ComputerProgressList> {
  return manageRequest(
    options,
    `/v1/computer/progress?taskId=${encodeURIComponent(taskId)}`,
    'GET',
    undefined,
    (json) => parse(ComputerProgressListSchema, json),
    fetchImpl,
  );
}

/**
 * Starts an attended trial of the saved automation's recipe, which acts for real; 409 when
 * `expectedRevision` is no longer the stored one.
 */
export function startComputerTrial(
  options: AgentClientOptions,
  automationId: string,
  body: ComputerTrialRequest,
  fetchImpl?: typeof fetch,
): Promise<ComputerTrialResponse> {
  return manageRequest(
    options,
    automationPath(automationId, '/computer-trial'),
    'POST',
    parse(ComputerTrialRequestSchema, body),
    (json) => parse(ComputerTrialResponseSchema, json),
    fetchImpl,
  );
}

/** A person reviewed the run that set the automation's hold and clears it; 409 for another run. */
export function resolveComputerHold(
  options: AgentClientOptions,
  automationId: string,
  body: ResolveComputerHoldRequest,
  fetchImpl?: typeof fetch,
): Promise<ResolveComputerHoldResponse> {
  return manageRequest(
    options,
    automationPath(automationId, '/computer-hold/resolve'),
    'POST',
    parse(ResolveComputerHoldRequestSchema, body),
    (json) => parse(ResolveComputerHoldResponseSchema, json),
    fetchImpl,
  );
}
