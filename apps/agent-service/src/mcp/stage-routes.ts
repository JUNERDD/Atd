import type { FastifyInstance } from 'fastify';
import { handleMcpStage } from './routes.js';
import { RENDERER_ROUTE } from '../relay-routes.js';

export interface McpStageRouteContext {
  dataDir: string;
}

/**
 * T6b additive: per-task MCP staging mount. Registered with the management
 * routes (not the authority routes) because staging is a pure file write:
 * it stays live while MCP is degraded, and the runner consumes it once at
 * the next run freeze with a working adapter.
 */
export function registerMcpStageRoute(app: FastifyInstance, ctx: McpStageRouteContext): void {
  app.post('/v1/mcp/stage', RENDERER_ROUTE, async (request) =>
    handleMcpStage(ctx.dataDir, request.body),
  );
}
