import { Type } from 'typebox';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
  McpServerUpsertRequestSchema,
  parse,
  type McpLaunchApprovalState,
  type McpServerConfig,
  type McpServerUpsertRequest,
} from '@ai/agent-contracts';

/** A saved server and whether it may launch as saved (mcp/launch-approvals.ts). */
export interface ConfiguredMcp {
  record: McpServerConfig;
  approval: McpLaunchApprovalState;
}

/** The authority's upsert (mcp/authority.ts), which merges and checks the edit. */
export type UpsertMcp = (
  serverId: string,
  request: McpServerUpsertRequest,
) => Promise<ConfiguredMcp>;

export interface ConfigureMcpHost {
  upsertMcp?: UpsertMcp;
  audit: (entry: Record<string, unknown>) => void;
  taskId: string;
  runId: () => string;
}

const request = McpServerUpsertRequestSchema.properties;

/**
 * An upsert without `env` or `headers`: the model never sets or sees their values, and leaving
 * them out keeps the stored ones (see `McpServerUpsertRequestSchema`).
 */
const DraftSchema = Type.Object(
  {
    serverId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    transport: request.transport,
    command: request.command,
    args: request.args,
    url: request.url,
    auth: request.auth,
  },
  { additionalProperties: false },
);

/**
 * Runs one `configure_mcp` call. The answer is a status only: the saved record holds env and
 * header values, which must never reach the model or the transcript. A server that runs a local
 * command or reads a service env var cannot run until the user approves it, which the model cannot
 * do; the answer says so instead of letting a later call fail unexplained.
 */
export async function configureMcp(host: ConfigureMcpHost, args: unknown) {
  if (!host.upsertMcp) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'MCP configuration is unavailable because the MCP authority is not loaded for this run.',
        },
      ],
      details: {},
    };
  }
  const { serverId, ...draft } = parse(DraftSchema, args);
  const { record: saved, approval } = await host.upsertMcp(serverId, draft);
  host.audit({
    taskId: host.taskId,
    runId: host.runId(),
    tool: 'configure_mcp',
    decision: 'applied',
    serverId,
  });
  const status = { serverId, revision: saved.revision, disabled: saved.disabled, approval };
  const content = [{ type: 'text' as const, text: JSON.stringify(status) }];
  if (approval === 'required' || approval === 'changed')
    content.push({
      type: 'text' as const,
      text:
        approval === 'required'
          ? `MCP server ${serverId} runs a local command or reads a service environment variable, so it cannot run until the user approves it in Settings › Extensions. Tell the user; you cannot approve it.`
          : `MCP server ${serverId} changed since the user approved it, so it cannot run until the user approves it again in Settings › Extensions. Tell the user; you cannot approve it.`,
    });
  return { content, details: {} };
}

/** Registers the parent-run `configure_mcp` tool that upserts one MCP server. */
export function registerConfigureMcpTool(pi: ExtensionAPI, host: ConfigureMcpHost): void {
  pi.registerTool({
    name: 'configure_mcp',
    label: 'Configure MCP server',
    description:
      'Add or update one MCP server in the service catalog. Prefer this over editing servers.json. ' +
      "An update keeps the server's stored environment variables and headers, which the result " +
      'never shows; a change that would send them to another command or URL origin is refused. ' +
      'A new or changed server that runs a local command, or whose token comes from an ' +
      "environment variable, needs the user's approval in Settings before it can run.",
    parameters: DraftSchema,
    executionMode: 'sequential',
    execute: (_id, args) => configureMcp(host, args),
  });
}
