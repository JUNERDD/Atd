import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import type { McpServerConfig } from '@ai/agent-contracts';
import { McpAdapterMissing, McpAuthority } from './mcp/index.js';
import { ResourceStore } from './resources.js';
import { readServiceId, type RunnerContext } from './task-runner.js';

export interface SessionMcpDeps {
  ctx: RunnerContext;
  taskId: string;
  currentRunId: () => string;
  executionId: () => string;
  audit: (entry: Record<string, unknown>) => void;
}

export interface SessionMcpPrep {
  factory: ExtensionFactory;
  configureMcp?: (servers: McpServerConfig[]) => Promise<McpServerConfig[]>;
  configuredMcp?: () => McpServerConfig[];
}

/**
 * Prepares MCP runner tools and optional catalog configure hooks for a parent
 * session. Adapter absence degrades to an empty factory without configure.
 */
export async function prepareSessionMcp(deps: SessionMcpDeps): Promise<SessionMcpPrep> {
  try {
    const serviceId = await readServiceId(deps.ctx.paths);
    const authority = await McpAuthority.authorityFor({
      serviceId,
      dataDir: deps.ctx.paths.root,
      agentDir: deps.ctx.paths.agentDir,
      sessionsDir: deps.ctx.paths.sessionsDir,
      cwd: deps.ctx.paths.root,
      events: deps.ctx.events,
      confirms: deps.ctx.confirms,
      resources: new ResourceStore(deps.ctx.ledger, deps.ctx.paths),
      log: deps.ctx.log,
    });
    const { factory, bindings } = await authority.prepareRunnerTools({
      taskId: deps.taskId,
      runId: deps.currentRunId,
      executionId: deps.executionId,
      audit: deps.audit,
      log: deps.ctx.log,
    });
    deps.audit({ taskId: deps.taskId, runId: deps.currentRunId(), mcpTools: bindings.length });
    return {
      factory,
      configureMcp: async (servers) => authority.configure({ servers }),
      configuredMcp: () => authority.configured(),
    };
  } catch (error) {
    if (!(error instanceof McpAdapterMissing)) throw error;
    deps.ctx.log.warn('MCP tools degraded: adapter is unavailable.', {
      taskId: deps.taskId,
    });
    deps.audit({ taskId: deps.taskId, runId: deps.currentRunId(), mcpDegraded: true });
    return { factory: () => undefined };
  }
}
