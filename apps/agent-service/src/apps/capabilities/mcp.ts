import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  type AppMcpTool,
  type McpCallToolInput,
  type McpCallToolOutput,
  type McpListToolsInput,
} from '@atd/agent-contracts';
import { McpApprovalBroker, McpError, type McpAuthority } from '../../mcp/index.js';
import { AppFailure, capabilityDenied } from '../errors.js';

/**
 * `mcp.listTools` and `mcp.callTool` through the MCP authority's facade, the path runner proxies
 * and the MCP routes use: launch approvals, the server's include/exclude lists, argument
 * validation and its configuration revision all apply. A tool the server's policy guards
 * (`approveTools`) needs a per-call confirm in a task, which an app call has no place to show,
 * so such calls are refused; the app can reach them through `agent.run`.
 */
export async function mcpListTools(
  authority: McpAuthority,
  input: McpListToolsInput,
  signal: AbortSignal,
): Promise<{ tools: AppMcpTool[] }> {
  const servers = authority
    .configured()
    .filter(
      (record) => !record.disabled && (!input.serverId || record.serverId === input.serverId),
    );
  if (input.serverId && !servers.length)
    throw new AppFailure(404, 'not_found', `No enabled MCP server ${input.serverId}.`);
  const tools: AppMcpTool[] = [];
  for (const record of servers) {
    try {
      for (const tool of await authority.facade.listTools(record.serverId, signal))
        tools.push({
          serverId: tool.serverId,
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
    } catch (error) {
      signal.throwIfAborted();
      // One server's failure (not approved, signed out, down) leaves the others listed.
      if (input.serverId) throw mcpFailure(error);
    }
  }
  return { tools: tools.slice(0, 1000) };
}

export async function mcpCallTool(
  authority: McpAuthority,
  appId: string,
  input: McpCallToolInput,
  signal: AbortSignal,
): Promise<McpCallToolOutput> {
  const record = authority.configured().find((item) => item.serverId === input.serverId);
  if (!record || record.disabled)
    throw new AppFailure(404, 'not_found', `No enabled MCP server ${input.serverId}.`);
  if (McpApprovalBroker.approvalRequired(record.approveTools, input.name))
    throw capabilityDenied(
      `MCP server ${input.serverId} asks for approval before ${input.name} runs, which an app call cannot ask for. Use agent.run for it.`,
    );
  try {
    const result = await authority.facade.callTool(
      {
        operationId: randomUUID(),
        // Apps have no task: no per-task connection alias, no task folder for artifacts.
        taskId: '',
        runId: '',
        executionId: `app:${appId}`,
        // Pinned to the revision whose policy was just checked.
        configRevision: record.revision,
      },
      input.serverId,
      input.name,
      input.arguments,
      signal,
    );
    return {
      content: result.content,
      ...(result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent }
        : {}),
      isError: result.isError,
    };
  } catch (error) {
    signal.throwIfAborted();
    throw mcpFailure(error);
  }
}

function mcpFailure(error: unknown): AppFailure {
  if (error instanceof McpError) {
    const code = error.code === 'forbidden' ? 'app_capability_denied' : error.code;
    return new AppFailure(error.code === 'not_found' ? 404 : 502, code, error.message);
  }
  return new AppFailure(502, 'upstream_failed', errorMessage(error));
}
