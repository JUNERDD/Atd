import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  McpServerConfigSchema,
  parse,
  type McpHttpAuth,
  type McpServerConfig,
} from '@ai/agent-contracts';

export type ConfigureMcpAuth =
  | { type: 'none' }
  | { type: 'bearer'; tokenEnv: string }
  | { type: 'oauth' };

export type ConfigureMcpDraft = {
  serverId: string;
  transport: 'stdio' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  auth: ConfigureMcpAuth;
};

export interface ConfigureMcpHost {
  configureMcp?: (servers: McpServerConfig[]) => Promise<McpServerConfig[]>;
  configuredMcp?: () => McpServerConfig[];
  audit: (entry: Record<string, unknown>) => void;
  taskId: string;
  runId: () => string;
}

const AuthSchema = Type.Union([
  Type.Object({ type: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal('bearer'),
      tokenEnv: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('oauth') }, { additionalProperties: false }),
]);

const DraftSchema = Type.Object(
  {
    serverId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    transport: Type.Union([
      Type.Literal('stdio'),
      Type.Literal('streamable-http'),
      Type.Literal('sse'),
    ]),
    command: Type.Optional(Type.String({ maxLength: 1024 })),
    args: Type.Optional(Type.Array(Type.String({ maxLength: 4096 }), { maxItems: 100 })),
    url: Type.Optional(Type.String({ maxLength: 2048 })),
    auth: AuthSchema,
  },
  { additionalProperties: false },
);

/** Registers the parent-run `configure_mcp` tool that upserts one MCP server. */
export function registerConfigureMcpTool(pi: ExtensionAPI, host: ConfigureMcpHost): void {
  pi.registerTool({
    name: 'configure_mcp',
    label: 'Configure MCP server',
    description:
      'Add or update one MCP server in the service catalog. Prefer this over editing servers.json.',
    parameters: DraftSchema,
    executionMode: 'sequential',
    async execute(_id, args) {
      void _id;
      if (!host.configureMcp || !host.configuredMcp) {
        return {
          content: [
            {
              type: 'text',
              text: 'MCP configuration is unavailable because the MCP authority is not loaded for this run.',
            },
          ],
          details: {},
        };
      }
      const draft = parse(DraftSchema, args) as ConfigureMcpDraft;
      const existing = host.configuredMcp();
      const previous = existing.find((server) => server.serverId === draft.serverId);
      const next = buildRecord(draft, previous);
      const merged = previous
        ? existing.map((server) => (server.serverId === draft.serverId ? next : server))
        : [...existing, next];
      const servers = await host.configureMcp(
        merged.map((server) => parse(McpServerConfigSchema, server)),
      );
      host.audit({
        taskId: host.taskId,
        runId: host.runId(),
        tool: 'configure_mcp',
        decision: 'applied',
        serverId: draft.serverId,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ serverId: draft.serverId, servers }) }],
        details: {},
      };
    },
  });
}

function httpAuth(auth: ConfigureMcpAuth, previous: McpHttpAuth | undefined): McpHttpAuth {
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
 * The connection part of a record from the draft. The draft carries no env, working directory or
 * headers, so updating an existing server keeps the ones it had for the same kind of transport;
 * switching between stdio and HTTP drops the other kind's fields, which no longer apply.
 */
function transportFields(
  draft: ConfigureMcpDraft,
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
  draft: ConfigureMcpDraft,
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
    connectionId: randomUUID(),
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
