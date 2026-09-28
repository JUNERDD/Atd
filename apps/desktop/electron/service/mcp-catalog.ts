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

/**
 * The records Settings may rewrite: Personal servers only. `mcpConfigure` replaces the whole user
 * catalog, so a server an installed plugin contributes must never be written back into it. Such a
 * record is marked with its `pluginId`, and its id is qualified (`<plugin>:<server>`, see
 * `McpServerIdSchema`), which user ids never are; either one keeps it out. The `pluginId` and
 * `readOnly` markers are not record fields and are dropped before the record is checked.
 */
function loadUserServers(raw: unknown[]): McpServerConfig[] {
  return raw.flatMap((record) => {
    const marked = typeof record === 'object' && record !== null;
    const pluginId = marked ? Reflect.get(record, 'pluginId') : undefined;
    const fields = marked
      ? Object.fromEntries(
          Object.entries(record).filter(([key]) => key !== 'pluginId' && key !== 'readOnly'),
        )
      : record;
    const server = parse(McpServerConfigSchema, fields);
    const plugin = (pluginId !== undefined && pluginId !== 'user') || server.serverId.includes(':');
    return plugin ? [] : [server];
  });
}

function httpAuth(auth: McpUpsertDraft['auth'], previous: McpHttpAuth | undefined): McpHttpAuth {
  switch (auth.type) {
    case 'none':
      return { type: 'none' };
    case 'bearer':
      return { type: 'bearer', tokenEnv: auth.tokenEnv };
    case 'oauth':
      // The draft has no scope or redirect fields; an OAuth server keeps the ones it had.
      return previous?.type === 'oauth'
        ? { type: 'oauth', scope: previous.scope, redirectUri: previous.redirectUri }
        : { type: 'oauth', scope: null, redirectUri: null };
    default: {
      const _exhaustive: never = auth;
      throw new Error(`Unsupported MCP auth: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * The connection part of a record from the draft. The draft carries only what the Settings form
 * edits, so an existing server keeps what the form cannot show: a stdio server its env and working
 * directory, an HTTP server its headers and OAuth scope/redirect. Switching between stdio and
 * HTTP drops the other kind's fields, which no longer apply.
 */
function transportFields(
  draft: McpUpsertDraft,
  existing: McpServerConfig | undefined,
): Pick<McpServerConfig, 'transport' | 'stdio' | 'http'> {
  switch (draft.transport) {
    case 'stdio': {
      const command = draft.command?.trim() ?? '';
      if (!command) throw new Error('A command is required for stdio MCP servers.');
      return {
        transport: 'stdio',
        stdio: {
          command,
          args: draft.args ?? [],
          env: existing?.stdio?.env ?? {},
          cwd: existing?.stdio?.cwd ?? null,
        },
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
          headers: existing?.http?.headers ?? {},
          auth: httpAuth(draft.auth, existing?.http?.auth),
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
  const fields = transportFields(draft, existing);
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

/** Loads the user's MCP records, upserts one draft, and replaces the user catalog. */
export async function upsertMcpServer(
  options: AgentClientOptions,
  draft: McpUpsertDraft,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadUserServers(raw);
  const existing = servers.find((server) => server.serverId === draft.serverId);
  const next = buildRecord(draft, existing);
  const merged = existing
    ? servers.map((server) => (server.serverId === draft.serverId ? next : server))
    : [...servers, next];
  return writeServers(options, merged);
}

/**
 * Turns one Personal server on or off and writes the user catalog; the record is otherwise kept.
 * A plugin's server is toggled through its plugin instead.
 */
export async function setMcpServerEnabled(
  options: AgentClientOptions,
  serverId: string,
  enabled: boolean,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadUserServers(raw);
  const found = servers.some((server) => server.serverId === serverId);
  if (!found) throw new Error(`MCP server "${serverId}" was not found.`);
  const merged = servers.map((server) =>
    server.serverId === serverId ? { ...server, disabled: !enabled } : server,
  );
  return writeServers(options, merged);
}

/** Omits one Personal server and writes the remaining user catalog. Does not call revoke. */
export async function removeMcpServer(
  options: AgentClientOptions,
  serverId: string,
): Promise<{ servers: unknown[] }> {
  const { servers: raw } = await mcpRecords({ options });
  const servers = loadUserServers(raw);
  const merged = servers.filter((server) => server.serverId !== serverId);
  if (merged.length === servers.length) throw new Error(`MCP server "${serverId}" was not found.`);
  return writeServers(options, merged);
}
