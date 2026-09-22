import { ErrorEnvelopeSchema, parse } from '@ai/agent-contracts';
import type { McpClient } from './mcp-client.js';
import { AgentClientError } from './types.js';

/**
 * Reads the configured MCP server records (no bearer tokens). Shape-checked
 * at the top level the same way `mcpStatus` checks `{ servers: array }`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasServers(json: unknown): json is { servers: unknown[] } {
  return isRecord(json) && Array.isArray(json['servers']);
}

function toClientError(status: number, json: unknown): AgentClientError {
  try {
    const envelope = parse(ErrorEnvelopeSchema, json);
    return new AgentClientError(envelope.error.code, status, envelope.error.message);
  } catch {
    return new AgentClientError('internal', status, `Request failed with status ${status}.`);
  }
}

export async function mcpRecords(client: McpClient): Promise<{ servers: unknown[] }> {
  const path = '/v1/mcp/servers';
  const fetchImpl = client.fetchImpl ?? fetch;
  const response = await fetchImpl(`${client.options.baseUrl}${path}`, {
    method: 'GET',
    headers: { authorization: `Bearer ${client.options.token}` },
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw toClientError(response.status, json);
  if (!hasServers(json))
    throw new AgentClientError(
      'internal',
      response.status,
      `Unexpected MCP response from ${path}.`,
    );
  return json;
}
