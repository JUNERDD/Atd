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
import { McpAdapterMissing } from './loader.js';
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

/**
 * Defers the authority load to first use so boot never pays for it. Resolving
 * it is the adapter's own cached per-profile load, so calling it per request
 * is a no-op once warm and rejects with `McpAdapterMissing` when it is not.
 */
export type McpAuthorityResolver = () => Promise<McpAuthority>;

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

/** The degraded contract: every MCP route answers this when the adapter is missing. */
const ADAPTER_MISSING_MESSAGE = 'MCP is unavailable: pi-mcp-adapter 2.38.0 could not be loaded.';

/**
 * Mounts the MCP handlers against a lazy authority so publishing the endpoint
 * never waits for the adapter. The resolver runs per request and the handlers
 * still see a resolved authority. Every route is authenticated by the service
 * bearer hook like all other routes, and both failure shapes are translated
 * here: `McpAdapterMissing` degrades explicitly to 503 (never a 500, never a
 * fake success) and `McpError` keeps its own status.
 */
export function registerMcpRoutes(app: FastifyInstance, authority: McpAuthorityResolver): void {
  const wrap =
    <T>(handler: (deps: McpRouteDeps, body: unknown) => T | Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        return await handler({ authority: await authority() }, request.body);
      } catch (error) {
        if (error instanceof McpAdapterMissing) {
          reply.status(503).send({ error: { code: 'internal', message: ADAPTER_MISSING_MESSAGE } });
          return;
        }
        if (error instanceof McpError) {
          reply
            .status(mcpErrorStatus(error.code))
            .send({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    };
  app.get('/v1/mcp/status', wrap(handleMcpStatus));
  app.get('/v1/mcp/servers', wrap(handleMcpRecords));
  app.get('/v1/mcp/snapshot', wrap(handleMcpSnapshot));
  app.post('/v1/mcp/configure', wrap(handleMcpConfigure));
  app.post('/v1/mcp/connect', wrap(handleMcpConnect));
  app.post('/v1/mcp/disconnect', wrap(handleMcpDisconnect));
  app.post('/v1/mcp/reconnect', wrap(handleMcpReconnect));
  app.post('/v1/mcp/revoke', wrap(handleMcpRevoke));
  app.post('/v1/mcp/auth/start', wrap(handleMcpAuthStart));
  app.post('/v1/mcp/auth/complete', wrap(handleMcpAuthComplete));
  app.post('/v1/mcp/refresh', wrap(handleMcpRefresh));
  app.post('/v1/mcp/logout', wrap(handleMcpLogout));
  app.post('/v1/mcp/tools/list', wrap(handleMcpListTools));
  app.post('/v1/mcp/tools/call', wrap(handleMcpCallTool));
  app.post('/v1/mcp/resources/list', wrap(handleMcpListResources));
  app.post('/v1/mcp/resources/templates', wrap(handleMcpListResourceTemplates));
  app.post('/v1/mcp/resources/read', wrap(handleMcpReadResource));
  app.post('/v1/mcp/prompts/list', wrap(handleMcpListPrompts));
  app.post('/v1/mcp/prompts/get', wrap(handleMcpGetPrompt));
}
