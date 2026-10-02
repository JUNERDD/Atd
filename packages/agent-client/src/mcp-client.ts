import {
  ErrorEnvelopeSchema,
  McpStatusResponseSchema,
  parse,
  type McpStatusResponse,
} from '@atd/agent-contracts';
import { manageRequest } from './manage-request.js';
import { authHeaders, AgentClientError, type AgentClientOptions } from './types.js';

/**
 * Standalone MCP client functions for the routes the renderer reaches: status, staging, connect,
 * OAuth, and launch approval withdrawal and notice (agent-contracts `mcp-approvals.ts`). Direct
 * server operations (tool calls, resources, prompts, disconnect, refresh, logout, snapshot) and
 * granting launch approvals are shell-only routes, so no renderer-side client exists for them.
 */

export interface McpClient {
  options: AgentClientOptions;
  fetchImpl?: typeof fetch;
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

function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}
