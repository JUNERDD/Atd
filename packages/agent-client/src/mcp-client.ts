import {
  ErrorEnvelopeSchema,
  McpStatusResponseSchema,
  parse,
  type McpStatusResponse,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import { authHeaders, AgentClientError, type AgentClientOptions } from './types.js';

/**
 * Standalone MCP client functions (T4). Shapes mirror the canonical
 * `agent-contracts/mcp` DTOs structurally; T34int swaps these interfaces
 * for the exported contract types once the index export lands. Responses
 * are shape-checked at the top level; full schema parsing moves to the
 * contracts import at integration.
 */

export interface McpClient {
  options: AgentClientOptions;
  fetchImpl?: typeof fetch;
}

export interface McpContentDto {
  type: string;
  [key: string]: unknown;
}

export interface McpCallResultDto {
  content: McpContentDto[];
  structuredContent: unknown;
  isError: boolean;
  attachments: Array<{ artifactId: string | null; kind: string; note: string }>;
  limitsNote: string;
}

async function post<T>(
  client: McpClient,
  path: string,
  body: unknown,
  check: (json: unknown) => json is T,
): Promise<T> {
  const fetchImpl = client.fetchImpl ?? fetch;
  const response = await fetchImpl(`${client.options.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(client.options),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  if (!check(json))
    throw new AgentClientError(
      'internal',
      response.status,
      `Unexpected MCP response from ${path}.`,
    );
  return json;
}

async function get<T>(
  client: McpClient,
  path: string,
  check: (json: unknown) => json is T,
): Promise<T> {
  const fetchImpl = client.fetchImpl ?? fetch;
  const response = await fetchImpl(`${client.options.baseUrl}${path}`, {
    method: 'GET',
    headers: authHeaders(client.options),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  if (!check(json))
    throw new AgentClientError(
      'internal',
      response.status,
      `Unexpected MCP response from ${path}.`,
    );
  return json;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasOk(json: unknown): json is { ok: boolean } {
  return isRecord(json) && typeof json['ok'] === 'boolean';
}

const decodeStatus = (json: unknown) => parse(McpStatusResponseSchema, json);

/** Every server's status row (plugin, connection, launch approval) and the approval notice. */
export function mcpStatus(client: McpClient): Promise<McpStatusResponse> {
  return manageRequest(
    client.options,
    '/v1/mcp/status',
    'GET',
    undefined,
    decodeStatus,
    client.fetchImpl,
  );
}

/**
 * Withdraws a server's launch approval (user or plugin server, `<plugin>:<server>` for the latter)
 * and stops it. Approving again takes the shell's native confirmation.
 */
export function mcpWithdrawApproval(
  client: McpClient,
  serverId: string,
): Promise<McpStatusResponse> {
  return manageRequest(
    client.options,
    `/v1/mcp/servers/${encodeURIComponent(serverId)}/approval`,
    'DELETE',
    undefined,
    decodeStatus,
    client.fetchImpl,
  );
}

/** Dismisses the one-time notice that existing servers need approving once. */
export function mcpDismissApprovalNotice(client: McpClient): Promise<McpStatusResponse> {
  return manageRequest(
    client.options,
    '/v1/mcp/approvals/notice/dismiss',
    'POST',
    {},
    decodeStatus,
    client.fetchImpl,
  );
}

export function mcpSnapshot(
  client: McpClient,
): Promise<{ revision: number; servers: unknown[] }> {
  return get(
    client,
    '/v1/mcp/snapshot',
    (json): json is { revision: number; servers: unknown[] } =>
      isRecord(json) && typeof json['revision'] === 'number' && Array.isArray(json['servers']),
  );
}

/** T6b additive: stages MCP tool selection for the next run of a task. */
export function mcpStage(
  client: McpClient,
  body: { taskId: string; tools: { connectionId: string; tool: string }[] },
): Promise<{ taskId: string; tools: { connectionId: string; tool: string }[]; stagedAt: string }> {
  return post(
    client,
    '/v1/mcp/stage',
    body,
    (
      json,
    ): json is {
      taskId: string;
      tools: { connectionId: string; tool: string }[];
      stagedAt: string;
    } => isRecord(json) && typeof json['taskId'] === 'string' && Array.isArray(json['tools']),
  );
}

export function mcpConnect(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/connect', body, hasOk);
}

export function mcpDisconnect(
  client: McpClient,
  body: { serverId: string },
): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/disconnect', body, hasOk);
}

export function mcpReconnect(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/reconnect', body, hasOk);
}

export function mcpRevoke(client: McpClient, body: { serverId: string }): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/revoke', body, hasOk);
}

export function mcpAuthStart(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{
  serverId: string;
  authenticated: boolean;
  authorizationUrl: string | null;
  mode: string;
}> {
  return post(
    client,
    '/v1/mcp/auth/start',
    body,
    (
      json,
    ): json is {
      serverId: string;
      authenticated: boolean;
      authorizationUrl: string | null;
      mode: string;
    } =>
      isRecord(json) &&
      typeof json['serverId'] === 'string' &&
      typeof json['authenticated'] === 'boolean',
  );
}

export function mcpAuthComplete(
  client: McpClient,
  body: { serverId: string; input: string; taskId?: string },
): Promise<{ serverId: string; authenticated: boolean }> {
  return post(
    client,
    '/v1/mcp/auth/complete',
    body,
    (json): json is { serverId: string; authenticated: boolean } =>
      isRecord(json) &&
      typeof json['serverId'] === 'string' &&
      typeof json['authenticated'] === 'boolean',
  );
}

export function mcpRefresh(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/refresh', body, hasOk);
}

export function mcpLogout(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ ok: boolean }> {
  return post(client, '/v1/mcp/logout', body, hasOk);
}

export function mcpListTools(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ tools: unknown[] }> {
  return post(
    client,
    '/v1/mcp/tools/list',
    body,
    (json): json is { tools: unknown[] } => isRecord(json) && Array.isArray(json['tools']),
  );
}

export function mcpListResources(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ resources: unknown[] }> {
  return post(
    client,
    '/v1/mcp/resources/list',
    body,
    (json): json is { resources: unknown[] } => isRecord(json) && Array.isArray(json['resources']),
  );
}

export function mcpListResourceTemplates(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ templates: unknown[] }> {
  return post(
    client,
    '/v1/mcp/resources/templates',
    body,
    (json): json is { templates: unknown[] } => isRecord(json) && Array.isArray(json['templates']),
  );
}

export function mcpListPrompts(
  client: McpClient,
  body: { serverId: string; taskId?: string },
): Promise<{ prompts: unknown[] }> {
  return post(
    client,
    '/v1/mcp/prompts/list',
    body,
    (json): json is { prompts: unknown[] } => isRecord(json) && Array.isArray(json['prompts']),
  );
}

export function mcpReadResource(
  client: McpClient,
  body: { serverId: string; uri: string; taskId?: string },
): Promise<{ serverId: string; uri: string; contents: unknown[] }> {
  return post(
    client,
    '/v1/mcp/resources/read',
    body,
    (json): json is { serverId: string; uri: string; contents: unknown[] } =>
      isRecord(json) && typeof json['uri'] === 'string' && Array.isArray(json['contents']),
  );
}

export function mcpGetPrompt(
  client: McpClient,
  body: { serverId: string; name: string; args?: Record<string, string>; taskId?: string },
): Promise<{ serverId: string; name: string; messages: unknown[]; preview: string }> {
  return post(
    client,
    '/v1/mcp/prompts/get',
    body,
    (json): json is { serverId: string; name: string; messages: unknown[]; preview: string } =>
      isRecord(json) && Array.isArray(json['messages']) && typeof json['preview'] === 'string',
  );
}

export function mcpCallTool(
  client: McpClient,
  body: {
    serverId: string;
    tool: string;
    args?: Record<string, unknown>;
    taskId?: string;
    runId?: string;
    executionId?: string;
    operationId?: string;
  },
): Promise<McpCallResultDto> {
  return post(
    client,
    '/v1/mcp/tools/call',
    body,
    (json): json is McpCallResultDto =>
      isRecord(json) && Array.isArray(json['content']) && typeof json['isError'] === 'boolean',
  );
}

function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}
