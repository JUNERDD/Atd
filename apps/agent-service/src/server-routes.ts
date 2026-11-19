import type { FastifyInstance } from 'fastify';
import { registerAddonRoutes } from './addons/index.js';
import { registerAtdAgentRoutes } from './atd-agents/mount.js';
import { registerAutomationRoutes } from './automations/routes.js';
import { registerBuiltinRoutes } from './builtins/mount.js';
import { registerComputerRoutes } from './computer/routes.js';
import { registerDiagnosticsRoutes } from './diagnostics/routes.js';
import { extractionLayout } from './file-loader/extraction-paths.js';
import { scheduleExtractionSweeps } from './file-loader/extraction-store-sweep.js';
import { registerFileRoutes } from './file-routes.js';
import { registerFolderRoutes } from './folders/routes.js';
import { registerManageRoutes } from './manage.js';
import type { McpAuthorityDeps } from './mcp/authority.js';
import { registerMcpRoutes } from './mcp/routes.js';
import { registerPluginRoutes } from './plugins/routes.js';
import { scheduleResourceSweeps } from './resources/gc.js';
import { registerResourceUpload } from './resources/routes.js';
import type { ServerDeps } from './server.js';
import { registerSkillRoutes } from './skills/mount.js';
import { registerTaskNotices } from './task-notices/routes.js';

/**
 * Registers all `/v1` domain route groups and background resource/extraction sweeps
 * after relay classification hooks are installed on `app`.
 */
export function registerDomainRoutes(app: FastifyInstance, deps: ServerDeps): void {
  registerResourceUpload(app, { resources: deps.resources, config: deps.config });
  // Resources no conversation references any longer go once the server listens, then daily.
  scheduleResourceSweeps(app, {
    ledger: deps.ledger,
    dir: deps.config.paths.resourcesDir,
    log: deps.log,
  });
  // What the file loader keeps of documents stays bounded, swept soon after start, then daily.
  const extractions = extractionLayout(deps.config.paths.extractionsDir);
  scheduleExtractionSweeps(app, { layout: extractions, log: deps.log });

  const resolveMcp = async () => {
    const { McpAuthority } = await import('./mcp/authority.js');
    return McpAuthority.authorityFor(mcpAuthorityDeps(deps));
  };

  // T6b additive: live management APIs (providers/commands/memory/tasks/resources).
  registerManageRoutes(app, {
    config: deps.config,
    ledger: deps.ledger,
    manager: deps.manager,
    settings: deps.settings,
    folders: deps.folders,
    log: deps.log,
    events: deps.events,
    mcp: resolveMcp,
  });

  registerSkillRoutes(app, deps.config);
  registerBuiltinRoutes(app, deps.config);
  registerAtdAgentRoutes(app, deps.config);
  registerFileRoutes(app, {
    resources: deps.resources,
    dataDir: deps.config.paths.root,
    log: deps.log,
  });
  registerFolderRoutes(app, { ledger: deps.ledger, folders: deps.folders });
  registerAutomationRoutes(app, deps.automations);
  registerComputerRoutes(app, deps.computer);
  registerAddonRoutes(app, {
    dataDir: deps.config.paths.root,
    addons: deps.addons,
    settings: deps.settings,
  });
  registerTaskNotices(app, deps);
  registerPluginRoutes(app, {
    dataDir: deps.config.paths.root,
    agentDir: deps.config.paths.agentDir,
    log: deps.log,
    mcp: resolveMcp,
  });

  // Live MCP mounts. Nothing at boot needs the authority (it reads the server records, launch
  // approvals and saved sign-ins), so the routes take a lazy resolver and it loads on first MCP
  // use (a route, a plugin toggle, or a run). `authorityFor` caches per dataDir, so all of those
  // share one load.
  registerMcpRoutes(app, resolveMcp);
  registerDiagnosticsRoutes(app, deps);
}

/**
 * The MCP authority identity for this service profile. `authorityFor` caches on
 * dataDir alone, so the plugin and MCP route resolvers must describe the same
 * profile from one place or the first caller would silently win.
 */
function mcpAuthorityDeps(deps: ServerDeps): McpAuthorityDeps {
  return {
    serviceId: deps.config.serviceId,
    dataDir: deps.config.paths.root,
    cwd: deps.config.paths.root,
    events: deps.events,
    confirms: deps.confirms,
    resources: deps.resources,
    log: deps.log,
  };
}
