import { createHash } from 'node:crypto';

/**
 * Stable MCP server keys (freeze candidate `mcp-server-key v1`).
 * Format: `mcp:<serviceId>:<serverId>:<principalHash8>` where principalHash8 is
 * the first 8 hex chars of sha256(serverId + '\0' + principal). The key is
 * stable across restarts for one (service, server, principal) triple and never
 * embeds secret material.
 */
export function mcpServerKey(serviceId: string, serverId: string, principal = ''): string {
  if (!serviceId || !serverId) throw new Error('mcpServerKey requires serviceId and serverId.');
  if (!/^[a-zA-Z0-9_-]+$/.test(serverId))
    throw new Error('MCP server ids use letters, digits, dash and underscore.');
  const hash = createHash('sha256').update(`${serverId}\0${principal}`).digest('hex').slice(0, 8);
  return `mcp:${serviceId}:${serverId}:${hash}`;
}

/** Parses a key produced by mcpServerKey; returns null for foreign shapes. */
export function parseMcpServerKey(key: string): {
  serviceId: string;
  serverId: string;
  principalHash: string;
} | null {
  const match = /^mcp:([a-zA-Z0-9_-]+):([a-zA-Z0-9_-]+):([0-9a-f]{8})$/.exec(key);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  return { serviceId: match[1], serverId: match[2], principalHash: match[3] };
}

/** True when the key belongs to this service identity. */
export function isOwnServerKey(serviceId: string, key: string): boolean {
  return parseMcpServerKey(key)?.serviceId === serviceId;
}
