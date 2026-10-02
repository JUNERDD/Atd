/**
 * The service names MCP proxies `mcp__<server>__<tool>` (agent-service `mcp/proxy-names.ts`); the
 * server part never holds `__`, so the first `__` after `mcp__` ends it.
 */
const MCP_PROXY = /^mcp__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)__(.+)$/;

/** The server and tool of an MCP proxy call, or `null` for any other tool name. */
export function mcpProxy(name: string): { server: string; tool: string } | null {
  const match = MCP_PROXY.exec(name);
  return match?.[1] && match[2] ? { server: match[1], tool: match[2] } : null;
}
