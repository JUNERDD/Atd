import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  McpLaunchApproveRequestSchema,
  parse,
  type McpLaunchApprovalDetails,
  type McpLaunchApproveResponse,
  type McpStatusResponse,
} from '@atd/agent-contracts';
import { RENDERER_ROUTE, SHELL_ROUTE } from '../relay-routes.js';
import type { McpRouteDeps } from './routes.js';

/**
 * Launch approval routes (contract in agent-contracts `mcp-approvals.ts`). Granting is shell-only:
 * the details and approve routes are reachable by main-token clients (the Swift shell and the
 * CLI) and never through the renderer relay. The renderer may withdraw an approval and
 * dismiss the one-time notice, neither of which lets anything run.
 */

type RouteHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
/** `registerMcpRoutes`' wrappers: authority resolution and McpError → HTTP translation. */
type Wrap = <T>(handler: (deps: McpRouteDeps, body: unknown) => T | Promise<T>) => RouteHandler;
type WrapServer = <T>(
  handler: (deps: McpRouteDeps, serverId: string, body: unknown) => T | Promise<T>,
) => RouteHandler;

export function handleLaunchDetails(
  deps: McpRouteDeps,
  serverId: string,
): Promise<McpLaunchApprovalDetails> {
  return deps.authority.launches.details(serverId);
}

/** Approves after the caller's confirmation; a server its refusal left waiting may connect now. */
export async function handleLaunchApprove(
  deps: McpRouteDeps,
  body: unknown,
): Promise<McpLaunchApproveResponse> {
  const request = parse(McpLaunchApproveRequestSchema, body);
  const approval = await deps.authority.launches.approve(request);
  if (deps.authority.states.get(request.serverId) === 'approval_required')
    deps.authority.states.set(request.serverId, 'disconnected', '');
  return { approval };
}

/** Withdraws an approval and stops the server, so nothing approved keeps running. */
export async function handleLaunchWithdraw(
  deps: McpRouteDeps,
  serverId: string,
): Promise<McpStatusResponse> {
  await deps.authority.launches.withdraw(serverId);
  await deps.authority.facade.disconnect(serverId);
  return deps.authority.launches.status(deps.authority.snapshot());
}

export async function handleApprovalNoticeDismiss(deps: McpRouteDeps): Promise<McpStatusResponse> {
  await deps.authority.launches.dismissNotice();
  return deps.authority.launches.status(deps.authority.snapshot());
}

export function registerLaunchRoutes(
  app: FastifyInstance,
  wrap: Wrap,
  wrapServer: WrapServer,
): void {
  app.get('/v1/admin/approvals/mcp/:serverId', SHELL_ROUTE, wrapServer(handleLaunchDetails));
  app.post('/v1/admin/approvals/mcp', SHELL_ROUTE, wrap(handleLaunchApprove));
  app.delete(
    '/v1/mcp/servers/:serverId/approval',
    RENDERER_ROUTE,
    wrapServer(handleLaunchWithdraw),
  );
  app.post('/v1/mcp/approvals/notice/dismiss', RENDERER_ROUTE, wrap(handleApprovalNoticeDismiss));
}
