import {
  McpServersResponseSchema,
  parse,
  type McpServersResponse,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';
import { manageRequest } from './manage-request.js';
import type { McpClient } from './mcp-client.js';

/**
 * The user's MCP servers over `/v1/mcp/servers` (routes in `agent-contracts/src/mcp-servers.ts`).
 * Every answer is the whole user catalog as views: env and header values arrive only as
 * `{ set: true }`, so edits keep them by name instead of sending them back.
 */

const decode = (json: unknown) => parse(McpServersResponseSchema, json);
const serverPath = (serverId: string) => `/v1/mcp/servers/${encodeURIComponent(serverId)}`;

export function mcpRecords(client: McpClient): Promise<McpServersResponse> {
  return manageRequest(
    client.options,
    '/v1/mcp/servers',
    'GET',
    undefined,
    decode,
    client.fetchImpl,
  );
}

/** Adds or updates one server; the service merges `env` and `headers` with the stored ones. */
export function mcpUpsertServer(
  client: McpClient,
  serverId: string,
  request: McpServerUpsertRequest,
): Promise<McpServersResponse> {
  return manageRequest(
    client.options,
    serverPath(serverId),
    'PUT',
    request,
    decode,
    client.fetchImpl,
  );
}

export function mcpSetServerEnabled(
  client: McpClient,
  serverId: string,
  enabled: boolean,
): Promise<McpServersResponse> {
  return manageRequest(
    client.options,
    `${serverPath(serverId)}/enabled`,
    'POST',
    { enabled },
    decode,
    client.fetchImpl,
  );
}

/** Removes one server; its stored bearer token or OAuth tokens are left as they are. */
export function mcpRemoveServer(client: McpClient, serverId: string): Promise<McpServersResponse> {
  return manageRequest(
    client.options,
    serverPath(serverId),
    'DELETE',
    undefined,
    decode,
    client.fetchImpl,
  );
}
