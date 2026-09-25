import {
  McpServerConfigSchema,
  parse,
  type McpHttpAuth,
  type McpServerConfig,
} from '@ai/agent-contracts';
import { mcpConfigure, mcpRecords, type AgentClientOptions } from '@ai/agent-client';

export type McpUpsertDraft = {
  serverId: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
};

function loadServers(raw: unknown[]): McpServerConfig[] {
  return raw.map((record) => parse(McpServerConfigSchema, record));
}

function httpAuth(auth: McpUpsertDraft['auth']): McpHttpAuth {
  switch (auth.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', tokenEnv: auth.tokenEnv };
    case 'oauth':
      return { type: 'oauth', scope: null, redirectUri: null };
    default: {
      const _exhaustive: never = auth;
      throw new Error(`Unsupported MCP auth: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function transportFields(
  draft: McpUpsertDraft,
): Pick<McpServerConfig, 'transport' | 'stdio' | 'http'> {
  switch (draft.transport) {
    case 'stdio': {
      const command = draft.command?.trim() ?? '';
      if (!command) throw new Error('A command is required for stdio MCP servers.');
      return {
        transport: 'stdio',
        stdio: { command, args: draft.args ?? [], env: {}, cwd: null },
        http: null,
      };
    }
    case 'streamable-http':
    case 'sse': {
      const url = draft.url?.trim() ?? '';
      if (!url) throw new Error('A URL is required for HTTP MCP servers.');
      return {
        transport: draft.transport,
        stdio: null,
        http: {
          url,
          transport: draft.transport,
          headers: {},
          auth: httpAuth(draft.auth),
        },
      };
    }
    default: {
      const _exhaustive: never = draft.transport;
      throw new Error(`Unsupported MCP transport: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function buildRecord(
  draft: McpUpsertDraft,
  existing: McpServerConfig | undefined,
): McpServerConfig {
  const fields = transportFields(draft);
  if (existing) {
    return {
      ...existing,
      transport: fields.transport,
      stdio: fields.stdio,
      http: fields.http,
    };
  }
  return {
    serverId: draft.serverId,
    revision: 1,
    connectionId: crypto.randomUUID(),
    transport: fields.transport,
    stdio: fields.stdio,
    http: fields.http,
    principal: '',
    isolateByTask: false,
    exposeResources: false,
    approveTools: true,
    includeTools: [],
    excludeTools: [],
    requestTimeoutMs: null,
    disabled: false,
  };
}

async function writeServers(
  options: AgentClientOptions,
  servers: McpServerConfig[],
): Promise<{ servers: unknown[] }> {
  return mcpConfigure({ options }, { servers });
}

/** Loads every MCP catalog record, upserts one draft, and replaces the full set. */
export async function upsertMcpServer(
  options: AgentClientOptions,
  draft: McpUpsertDraft,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadServers(raw);
  const existing = servers.find((server) => server.serverId === draft.serverId);
  const next = buildRecord(draft, existing);
  const merged = existing
    ? servers.map((server) => (server.serverId === draft.serverId ? next : server))
    : [...servers, next];
  return writeServers(options, merged);
}

/** Sets disabled on one server and writes the full catalog. */
export async function disableMcpServer(
  options: AgentClientOptions,
  serverId: string,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadServers(raw);
  const found = servers.some((server) => server.serverId === serverId);
  if (!found) throw new Error(`MCP server "${serverId}" was not found.`);
  const merged = servers.map((server) =>
    server.serverId === serverId ? { ...server, disabled: true } : server,
  );
  return writeServers(options, merged);
}

/** Omits one server and writes the remaining catalog. Does not call revoke. */
export async function removeMcpServer(
  options: AgentClientOptions,
  serverId: string,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadServers(raw);
  const merged = servers.filter((server) => server.serverId !== serverId);
  if (merged.length === servers.length) throw new Error(`MCP server "${serverId}" was not found.`);
  return writeServers(options, merged);
}
