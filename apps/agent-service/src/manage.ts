import type { FastifyInstance } from 'fastify';
import { registerCommandRoutes } from './commands/routes.js';
import type { ServiceConfig } from './config.js';
import type { Ledger } from './ledger.js';
import type { Logger } from './logging.js';
import { registerMcpStageRoute } from './mcp/stage-routes.js';
import { registerMemoryRoutes } from './memory/routes.js';
import { registerProviderRoutes } from './providers/routes.js';
import { registerResourceRoutes } from './resources/routes.js';
import type { RunnerManager } from './runner-manager.js';
import { registerTaskManageRoutes } from './tasks/manage.js';
import { registerPreviewRoute } from './tasks/preview.js';

export interface ManageContext {
  config: ServiceConfig;
  ledger: Ledger;
  manager: RunnerManager;
  log: Logger;
}

/**
 * T6b management mounts (service v1.2 candidate): providers, commands,
 * memory, task PATCH/DELETE/queue-replace, read-only preview, and resource
 * download. MCP stage mounts with the MCP routes (same release).
 */
export function registerManageRoutes(app: FastifyInstance, ctx: ManageContext): void {
  registerProviderRoutes(app, {
    serviceId: ctx.config.serviceId,
    dataDir: ctx.config.paths.root,
  });
  registerCommandRoutes(app, { dataDir: ctx.config.paths.root });
  registerMemoryRoutes(app, { agentDir: ctx.config.paths.agentDir, log: ctx.log });
  registerTaskManageRoutes(app, { ledger: ctx.ledger, manager: ctx.manager });
  registerPreviewRoute(app, { dataDir: ctx.config.paths.root, ledger: ctx.ledger });
  registerResourceRoutes(app, { ledger: ctx.ledger, paths: ctx.config.paths });
  registerMcpStageRoute(app, { dataDir: ctx.config.paths.root });
}
