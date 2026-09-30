import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import {
  McpServerEnabledRequestSchema,
  McpServerIdSchema,
  McpServerUpsertRequestSchema,
  parse,
  type McpAuthCompleteResponse,
  type McpAuthStartResponse,
  type McpCallResult,
  type McpGetPromptResponse,
  type McpReadResourceResponse,
  type McpServersResponse,
  type McpSnapshot,
  type McpStatusResponse,
} from '@ai/agent-contracts';
import type { McpAuthority } from './authority.js';
import { McpError, type OperationContext } from './errors.js';
import { promptPreviewToInput } from './mapping.js';
import { serverView } from './server-edits.js';
import {
  McpAuthCompleteRequestSchema,
  McpCallToolRequestSchema,
  McpGetPromptRequestSchema,
  McpReadResourceRequestSchema,
  McpServerRequestSchema,
  McpStageRequestSchema,
} from './requests.js';
import { stageTaskMcp } from './staging.js';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import { registerLaunchRoutes } from './launch-routes.js';

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
 * it is the authority's cached per-profile load (`McpAuthority.authorityFor`),
 * so calling it per request is a no-op once warm.
 */
export type McpAuthorityResolver = () => Promise<McpAuthority>;

const ServerParamsSchema = Type.Object(
  { serverId: McpServerIdSchema },
  { additionalProperties: false },
);

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

/** Status rows with their plugin and launch approval, and the one-time approval notice. */
export function handleMcpStatus(deps: McpRouteDeps): Promise<McpStatusResponse> {
  return deps.authority.launches.status(deps.authority.snapshot());
}

/** The user's servers with env and header values redacted (mcp/server-edits.ts). */
export function handleMcpRecords(deps: McpRouteDeps): McpServersResponse {
  return { servers: deps.authority.configured().map(serverView) };
}

export async function handleMcpUpsert(deps: McpRouteDeps, serverId: string, body: unknown) {
  await deps.authority.upsert(serverId, parse(McpServerUpsertRequestSchema, body));
  return handleMcpRecords(deps);
}

export async function handleMcpSetEnabled(deps: McpRouteDeps, serverId: string, body: unknown) {
  await deps.authority.setEnabled(serverId, parse(McpServerEnabledRequestSchema, body).enabled);
  return handleMcpRecords(deps);
}

export async function handleMcpRemove(deps: McpRouteDeps, serverId: string) {
  await deps.authority.remove(serverId);
  return handleMcpRecords(deps);
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
    case 'approval_required':
      return 403;
    case 'not_found':
      return 404;
    case 'conflict':
    case 'approval_changed':
      return 409;
    case 'gone':
      return 410;
    case 'internal':
      return 500;
  }
}

/**
 * Mounts the MCP handlers against a lazy authority so publishing the endpoint
 * never waits for the authority to load. The resolver runs per request and the
 * handlers still see a resolved authority. Every route is authenticated by the
 * service bearer hook like all other routes, and an `McpError` keeps its own
 * status.
 */
export function registerMcpRoutes(app: FastifyInstance, authority: McpAuthorityResolver): void {
  const run = async <T>(reply: FastifyReply, work: (deps: McpRouteDeps) => T | Promise<T>) => {
    try {
      return await work({ authority: await authority() });
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
  const wrap =
    <T>(handler: (deps: McpRouteDeps, body: unknown) => T | Promise<T>) =>
    (request: FastifyRequest, reply: FastifyReply) =>
      run(reply, (deps) => handler(deps, request.body));
  // One user server by path; a malformed id is a 400 before the authority loads.
  const wrapServer =
    <T>(handler: (deps: McpRouteDeps, serverId: string, body: unknown) => T | Promise<T>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { serverId } = parse(ServerParamsSchema, request.params);
      return run(reply, (deps) => handler(deps, serverId, request.body));
    };
  // The renderer (through the shell relay) reaches only status, its server edits, connect, OAuth
  // and approval withdrawal; direct operations on servers are for main-token clients alone.
  app.get('/v1/mcp/status', RENDERER_ROUTE, wrap(handleMcpStatus));
  app.get('/v1/mcp/servers', RENDERER_ROUTE, wrap(handleMcpRecords));
  app.put('/v1/mcp/servers/:serverId', RENDERER_ROUTE, wrapServer(handleMcpUpsert));
  app.post('/v1/mcp/servers/:serverId/enabled', RENDERER_ROUTE, wrapServer(handleMcpSetEnabled));
  app.delete('/v1/mcp/servers/:serverId', RENDERER_ROUTE, wrapServer(handleMcpRemove));
  app.get('/v1/mcp/snapshot', SHELL_ROUTE, wrap(handleMcpSnapshot));
  app.post('/v1/mcp/connect', RENDERER_ROUTE, wrap(handleMcpConnect));
  app.post('/v1/mcp/disconnect', SHELL_ROUTE, wrap(handleMcpDisconnect));
  app.post('/v1/mcp/reconnect', SHELL_ROUTE, wrap(handleMcpReconnect));
  app.post('/v1/mcp/revoke', SHELL_ROUTE, wrap(handleMcpRevoke));
  app.post('/v1/mcp/auth/start', RENDERER_ROUTE, wrap(handleMcpAuthStart));
  app.post('/v1/mcp/auth/complete', RENDERER_ROUTE, wrap(handleMcpAuthComplete));
  app.post('/v1/mcp/refresh', SHELL_ROUTE, wrap(handleMcpRefresh));
  app.post('/v1/mcp/logout', SHELL_ROUTE, wrap(handleMcpLogout));
  app.post('/v1/mcp/tools/list', SHELL_ROUTE, wrap(handleMcpListTools));
  app.post('/v1/mcp/tools/call', SHELL_ROUTE, wrap(handleMcpCallTool));
  app.post('/v1/mcp/resources/list', SHELL_ROUTE, wrap(handleMcpListResources));
  app.post('/v1/mcp/resources/templates', SHELL_ROUTE, wrap(handleMcpListResourceTemplates));
  app.post('/v1/mcp/resources/read', SHELL_ROUTE, wrap(handleMcpReadResource));
  app.post('/v1/mcp/prompts/list', SHELL_ROUTE, wrap(handleMcpListPrompts));
  app.post('/v1/mcp/prompts/get', SHELL_ROUTE, wrap(handleMcpGetPrompt));
  registerLaunchRoutes(app, wrap, wrapServer);
}
