import {
  CompactTaskRequestSchema,
  CompactTaskResponseSchema,
  DeleteTaskResponseSchema,
  ForkTaskRequestSchema,
  ForkTaskResponseSchema,
  parse,
  PatchTaskRequestSchema,
  PreviewTaskRequestSchema,
  PreviewTaskResponseSchema,
  ReplaceQueueRequestSchema,
  ReplaceQueueResponseSchema,
  TaskResponseSchema,
  type CompactTaskResponse,
  type DeleteTaskResponse,
  type ForkTaskRequest,
  type ForkTaskResponse,
  type PatchTaskRequest,
  type PreviewTaskRequest,
  type PreviewTaskResponse,
  type ReplaceQueueResponse,
  type TaskResponse,
} from '@ai/agent-contracts';
import { dispositionName, manageRequest, toClientError } from './manage-request.js';
import { authHeaders, type AgentClientOptions } from './types.js';

/** Renames and/or retiers a task. */
export function patchTask(
  options: AgentClientOptions,
  taskId: string,
  body: PatchTaskRequest,
  fetchImpl?: typeof fetch,
): Promise<TaskResponse> {
  return manageRequest(
    options,
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    'PATCH',
    parse(PatchTaskRequestSchema, body),
    (json) => parse(TaskResponseSchema, json),
    fetchImpl,
  );
}

/** Deletes an idle task with its idempotency entries and orphaned requests. */
export function deleteTask(
  options: AgentClientOptions,
  taskId: string,
  fetchImpl?: typeof fetch,
): Promise<DeleteTaskResponse> {
  return manageRequest(
    options,
    `/v1/tasks/${encodeURIComponent(taskId)}`,
    'DELETE',
    undefined,
    (json) => parse(DeleteTaskResponseSchema, json),
    fetchImpl,
  );
}

/** Replaces a task's pending follow-ups; steering is preserved. */
export function replaceQueue(
  options: AgentClientOptions,
  taskId: string,
  followUp: string[],
  fetchImpl?: typeof fetch,
): Promise<ReplaceQueueResponse> {
  return manageRequest(
    options,
    `/v1/tasks/${encodeURIComponent(taskId)}/queue/replace`,
    'POST',
    parse(ReplaceQueueRequestSchema, { followUp }),
    (json) => parse(ReplaceQueueResponseSchema, json),
    fetchImpl,
  );
}

/** Compacts an idle task's context now, optionally focused by `instructions`. */
export function compactTask(
  options: AgentClientOptions,
  taskId: string,
  instructions?: string,
  fetchImpl?: typeof fetch,
): Promise<CompactTaskResponse> {
  return manageRequest(
    options,
    `/v1/tasks/${encodeURIComponent(taskId)}/compact`,
    'POST',
    parse(CompactTaskRequestSchema, instructions === undefined ? {} : { instructions }),
    (json) => parse(CompactTaskResponseSchema, json),
    fetchImpl,
  );
}

/** Forks a task into a new one at the turn `body.entryId` starts; the source is unchanged. */
export function forkTask(
  options: AgentClientOptions,
  taskId: string,
  body: ForkTaskRequest,
  fetchImpl?: typeof fetch,
): Promise<ForkTaskResponse> {
  return manageRequest(
    options,
    `/v1/tasks/${encodeURIComponent(taskId)}/fork`,
    'POST',
    parse(ForkTaskRequestSchema, body),
    (json) => parse(ForkTaskResponseSchema, json),
    fetchImpl,
  );
}

/** Read-only run preview: the snapshot a submit would freeze. */
export function previewTask(
  options: AgentClientOptions,
  body: PreviewTaskRequest,
  fetchImpl?: typeof fetch,
): Promise<PreviewTaskResponse> {
  return manageRequest(
    options,
    '/v1/tasks/preview',
    'POST',
    parse(PreviewTaskRequestSchema, body),
    (json) => parse(PreviewTaskResponseSchema, json),
    fetchImpl,
  );
}

/** Downloads raw resource bytes; headers carry the stored mime and name. */
export async function downloadResource(
  options: AgentClientOptions,
  resourceId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const response = await fetchImpl(
    `${options.baseUrl}/v1/resources/${encodeURIComponent(resourceId)}`,
    { method: 'GET', headers: authHeaders(options) },
  );
  if (!response.ok) {
    const json: unknown = await response.json().catch(() => null);
    throw toClientError(response.status, json);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return {
    bytes,
    mime: response.headers.get('content-type') ?? 'application/octet-stream',
    name: dispositionName(response.headers.get('content-disposition')),
  };
}
