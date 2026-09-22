import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  parse,
  type McpAuthCompleteResponse,
  type McpAuthStartResponse,
  type McpCallResult,
  type McpGetPromptResponse,
  type McpReadResourceResponse,
  type McpServerConfig,
  type McpServerStatus,
  type McpSnapshot,
} from '@ai/agent-contracts';
import type { McpAuthority } from './authority.js';
import { McpError, type OperationContext } from './errors.js';
import { promptPreviewToInput } from './mapping.js';
import {
  McpAuthCompleteRequestSchema,
  McpCallToolRequestSchema,
  McpConfigureRequestSchema,
  McpGetPromptRequestSchema,
  McpReadResourceRequestSchema,
  McpServerRequestSchema,
  McpStageRequestSchema,
} from './requests.js';
import { stageTaskMcp } from './staging.js';

/**
 * MCP route handlers, UNMOUNTED (D6/T34int). T34int mounts them via
 * `registerMcpRoutes` after T3/T4 land; T4 proves every handler through
 * direct calls. Handlers parse with the wire schemas, delegate to the
 * authority, and translate McpError codes to HTTP statuses.
 */

export interface McpRouteDeps {
  authority: McpAuthority;
}

const ANONYMOUS_OP: OperationContext = {
  operationId: 'mcp-direct',
  taskId: 'mcp',
  runId: 'mcp',
  executionId: 'service:mcp',
};

function opFrom(body: {
  taskId?: string;
  runId?: string;
  executionId?: string;
  operationId?: string;
}): OperationContext {
  return {
    operationId: body.operationId ?? randomUUID(),
    taskId: body.taskId ?? ANONYMOUS_OP.taskId,
    runId: body.runId ?? ANONYMOUS_OP.runId,
    executionId: body.executionId ?? ANONYMOUS_OP.executionId,
  };
}

export function handleMcpStatus(deps: McpRouteDeps): { servers: McpServerStatus[] } {
  return { servers: deps.authority.snapshot().servers };
}

export function handleMcpRecords(deps: McpRouteDeps): { servers: McpServerConfig[] } {
  return { servers: deps.authority.configured() };
}

export function handleMcpSnapshot(deps: McpRouteDeps): McpSnapshot {
  return deps.authority.snapshot();
}

/**
 * T6b additive: stages MCP tool selection for the next run of a task. Pure
 * staging write (no authority load, works while MCP is degraded); the
 * runner consumes it once at run freeze. Mounted via stage-routes.ts.
 */
export async function handleMcpStage(dataDir: string, body: unknown) {
  const parsed = parse(McpStageRequestSchema, body);
  const staging = await stageTaskMcp(dataDir, parsed.taskId, parsed.tools);
  return { taskId: parsed.taskId, tools: staging.tools, stagedAt: staging.stagedAt };
}

export async function handleMcpConfigure(deps: McpRouteDeps, body: unknown) {
  const parsed = parse(McpConfigureRequestSchema, body);
  return { servers: await deps.authority.configure(parsed) };
}

export async function handleMcpConnect(deps: McpRouteDeps, body: unknown, signal?: AbortSignal) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.facade.connect(parsed.serverId, signal, parsed.taskId);
  return { ok: true as const };
}

export async function handleMcpDisconnect(deps: McpRouteDeps, body: unknown) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.facade.disconnect(parsed.serverId);
  return { ok: true as const };
}

export async function handleMcpReconnect(deps: McpRouteDeps, body: unknown, signal?: AbortSignal) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.facade.reconnect(parsed.serverId, signal, parsed.taskId);
  return { ok: true as const };
}

export async function handleMcpRevoke(deps: McpRouteDeps, body: unknown) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.revoke(parsed.serverId);
  return { ok: true as const };
}

export async function handleMcpAuthStart(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
): Promise<McpAuthStartResponse> {
  const parsed = parse(McpServerRequestSchema, body);
  return deps.authority.authManager.start(parsed.serverId, signal, parsed.taskId);
}

export async function handleMcpAuthComplete(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
): Promise<McpAuthCompleteResponse> {
  const parsed = parse(McpAuthCompleteRequestSchema, body);
  return deps.authority.authManager.complete(parsed.serverId, parsed.input, signal, parsed.taskId);
}

export async function handleMcpRefresh(deps: McpRouteDeps, body: unknown, signal?: AbortSignal) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.authManager.refresh(parsed.serverId, signal, parsed.taskId);
  return { ok: true as const };
}

export async function handleMcpLogout(deps: McpRouteDeps, body: unknown) {
  const parsed = parse(McpServerRequestSchema, body);
  await deps.authority.authManager.logout(parsed.serverId, parsed.taskId);
  return { ok: true as const };
}

export async function handleMcpListTools(deps: McpRouteDeps, body: unknown, signal?: AbortSignal) {
  const parsed = parse(McpServerRequestSchema, body);
  return { tools: await deps.authority.facade.listTools(parsed.serverId, signal, parsed.taskId) };
}

export async function handleMcpListResources(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
) {
  const parsed = parse(McpServerRequestSchema, body);
  return {
    resources: await deps.authority.facade.listResources(parsed.serverId, signal, parsed.taskId),
  };
}

export async function handleMcpListResourceTemplates(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
) {
  const parsed = parse(McpServerRequestSchema, body);
  return {
    templates: await deps.authority.facade.listResourceTemplates(
      parsed.serverId,
      signal,
      parsed.taskId,
    ),
  };
}

export async function handleMcpListPrompts(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
) {
  const parsed = parse(McpServerRequestSchema, body);
  return {
    prompts: await deps.authority.facade.listPrompts(parsed.serverId, signal, parsed.taskId),
  };
}

export async function handleMcpReadResource(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
): Promise<McpReadResourceResponse> {
  const parsed = parse(McpReadResourceRequestSchema, body);
  return deps.authority.facade.readResource(opFrom(parsed), parsed.serverId, parsed.uri, signal);
}

export async function handleMcpGetPrompt(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
): Promise<McpGetPromptResponse & { preview: string }> {
  const parsed = parse(McpGetPromptRequestSchema, body);
  const prompt = await deps.authority.facade.getPrompt(
    opFrom(parsed),
    parsed.serverId,
    parsed.name,
    parsed.args,
    signal,
  );
  return { ...prompt, preview: promptPreviewToInput(prompt) };
}

export async function handleMcpCallTool(
  deps: McpRouteDeps,
  body: unknown,
  signal?: AbortSignal,
): Promise<McpCallResult> {
  const parsed = parse(McpCallToolRequestSchema, body);
  return deps.authority.facade.callTool(
    opFrom(parsed),
    parsed.serverId,
    parsed.tool,
    parsed.args,
    signal,
  );
}

/** HTTP status for an MCP error code (`auth_required` rides 401 with its own code). */
export function mcpErrorStatus(code: McpError['code']): number {
  switch (code) {
    case 'bad_request':
      return 400;
    case 'auth_required':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'gone':
      return 410;
    case 'internal':
      return 500;
  }
}

/**
 * Mounts the MCP handlers. T34int ONLY — T4 never calls this (the T1
 * placeholder contract in server.ts stays until integration). Every route
 * is authenticated by the service bearer hook like all other routes.
 */
export function registerMcpRoutes(app: FastifyInstance, deps: McpRouteDeps): void {
  const wrap =
    <T>(handler: (body: unknown, signal?: AbortSignal) => Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await handler(request.body);
      } catch (error) {
        if (error instanceof McpError) {
          reply
            .status(mcpErrorStatus(error.code))
            .send({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    };
  app.get('/v1/mcp/status', async () => handleMcpStatus(deps));
  app.get('/v1/mcp/servers', async () => handleMcpRecords(deps));
  app.get('/v1/mcp/snapshot', async () => handleMcpSnapshot(deps));
  app.post(
    '/v1/mcp/configure',
    wrap((body) => handleMcpConfigure(deps, body)),
  );
  app.post(
    '/v1/mcp/connect',
    wrap((body, signal) => handleMcpConnect(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/disconnect',
    wrap((body) => handleMcpDisconnect(deps, body)),
  );
  app.post(
    '/v1/mcp/reconnect',
    wrap((body, signal) => handleMcpReconnect(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/revoke',
    wrap((body) => handleMcpRevoke(deps, body)),
  );
  app.post(
    '/v1/mcp/auth/start',
    wrap((body, signal) => handleMcpAuthStart(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/auth/complete',
    wrap((body, signal) => handleMcpAuthComplete(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/refresh',
    wrap((body, signal) => handleMcpRefresh(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/logout',
    wrap((body) => handleMcpLogout(deps, body)),
  );
  app.post(
    '/v1/mcp/tools/list',
    wrap((body, signal) => handleMcpListTools(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/tools/call',
    wrap((body, signal) => handleMcpCallTool(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/resources/list',
    wrap((body, signal) => handleMcpListResources(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/resources/templates',
    wrap((body, signal) => handleMcpListResourceTemplates(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/resources/read',
    wrap((body, signal) => handleMcpReadResource(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/prompts/list',
    wrap((body, signal) => handleMcpListPrompts(deps, body, signal)),
  );
  app.post(
    '/v1/mcp/prompts/get',
    wrap((body, signal) => handleMcpGetPrompt(deps, body, signal)),
  );
}
