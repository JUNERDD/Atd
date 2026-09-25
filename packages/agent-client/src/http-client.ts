import { Type } from 'typebox';
import {
  CancelRunResponseSchema,
  ChildTranscriptResponseSchema,
  ConfirmReplyRequestSchema,
  ConfirmReplyResponseSchema,
  CredentialUploadRequestSchema,
  CredentialUploadResponseSchema,
  ErrorEnvelopeSchema,
  MigrationStatusResponseSchema,
  parse,
  QueueMessageRequestSchema,
  ResourceUploadResponseSchema,
  SnapshotResponseSchema,
  StatusResponseSchema,
  SubmitTaskRequestSchema,
  SubmitTaskResponseSchema,
  TaskResponseSchema,
  type CancelRunResponse,
  type CapabilityReplyRequest,
  type ChildTranscriptResponse,
  type ConfirmReplyRequest,
  type ConfirmReplyResponse,
  type CredentialUploadRequest,
  type CredentialUploadResponse,
  type MigrationStatusResponse,
  type QueueMessageRequest,
  type ResourceUploadResponse,
  type SnapshotResponse,
  type StatusResponse,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
  type TaskResponse,
} from '@ai/agent-contracts';
import { AgentClientError, type AgentClientOptions } from './types.js';

/** Typed HTTP client for the agent service; fetch is injected for testing. */
export class AgentHttpClient {
  constructor(
    private readonly options: AgentClientOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): Promise<StatusResponse> {
    return this.request('/v1/status', 'GET', undefined, (json) =>
      parse(StatusResponseSchema, json),
    );
  }

  submit(body: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    return this.request('/v1/tasks', 'POST', parse(SubmitTaskRequestSchema, body), (json) =>
      parse(SubmitTaskResponseSchema, json),
    );
  }

  task(taskId: string): Promise<TaskResponse> {
    return this.request(`/v1/tasks/${encodeURIComponent(taskId)}`, 'GET', undefined, (json) =>
      parse(TaskResponseSchema, json),
    );
  }

  snapshot(taskId: string): Promise<SnapshotResponse> {
    return this.request(
      `/v1/tasks/${encodeURIComponent(taskId)}/snapshot`,
      'GET',
      undefined,
      (json) => parse(SnapshotResponseSchema, json),
    );
  }

  /** One child session's transcript; `childKey` is `<toolCallId>:<seq>` from the subagent details. */
  childTranscript(taskId: string, childKey: string): Promise<ChildTranscriptResponse> {
    return this.request(
      `/v1/tasks/${encodeURIComponent(taskId)}/children/${encodeURIComponent(childKey)}/transcript`,
      'GET',
      undefined,
      (json) => parse(ChildTranscriptResponseSchema, json),
    );
  }

  cancel(taskId: string, runId: string): Promise<CancelRunResponse> {
    return this.request(
      `/v1/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}/cancel`,
      'POST',
      {},
      (json) => parse(CancelRunResponseSchema, json),
    );
  }

  confirm(body: ConfirmReplyRequest): Promise<ConfirmReplyResponse> {
    return this.request('/v1/confirms', 'POST', parse(ConfirmReplyRequestSchema, body), (json) =>
      parse(ConfirmReplyResponseSchema, json),
    );
  }

  capabilityResult(body: CapabilityReplyRequest): Promise<{ ok: boolean }> {
    return this.request('/v1/capabilities/result', 'POST', body, (json) =>
      parse(CapabilityOkSchema(), json),
    );
  }

  queue(taskId: string, body: QueueMessageRequest): Promise<{ ok: boolean }> {
    return this.request(
      `/v1/tasks/${encodeURIComponent(taskId)}/queue`,
      'POST',
      parse(QueueMessageRequestSchema, body),
      (json) => parse(CapabilityOkSchema(), json),
    );
  }

  upload(name: string, mime: string, bytes: Uint8Array): Promise<ResourceUploadResponse> {
    return this.rawRequest<unknown>(
      `/v1/resources?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime)}`,
      'POST',
      bytes,
      'application/octet-stream',
    ).then((json) => parse(ResourceUploadResponseSchema, json));
  }

  /** T2 additive: one-time credential upload over the authenticated channel. */
  uploadCredential(body: CredentialUploadRequest): Promise<CredentialUploadResponse> {
    return this.request(
      '/v1/migration/credentials',
      'POST',
      parse(CredentialUploadRequestSchema, body),
      (json) => parse(CredentialUploadResponseSchema, json),
    );
  }

  /** T2 additive: reads the service migration manifest (secret-free). */
  migrationStatus(): Promise<MigrationStatusResponse> {
    return this.request('/v1/migration/status', 'GET', undefined, (json) =>
      parse(MigrationStatusResponseSchema, json),
    );
  }

  private async request<T>(
    path: string,
    method: string,
    body: unknown,
    decode: (json: unknown) => T,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw toClientError(response.status, json);
    return decode(json);
  }

  private async rawRequest<T>(
    path: string,
    method: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.options.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.options.token}`, 'content-type': contentType },
      body: body as Uint8Array<ArrayBuffer>,
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw toClientError(response.status, json);
    return json as T;
  }
}

function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}

function CapabilityOkSchema() {
  return Type.Object({ ok: Type.Boolean() }, { additionalProperties: false });
}
