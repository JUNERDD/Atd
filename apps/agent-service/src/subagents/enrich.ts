import type { SessionFactoryDeps } from '../pi-session.js';
import type { RunnerContext } from '../task-runner.js';
import { MemoryAuthority } from '../memory/authority.js';
import { childMemoryProxy } from '../memory/proxy.js';
import { McpAuthority } from '../mcp/index.js';
import { readServiceId } from '../storage.js';
import { ResourceStore } from '../resources.js';
import { skillProfilePaths } from '../skills/profile.js';
import { loadRunRole } from '../skills/roles.js';
import { intersectChildTools } from './intersection.js';
import { hostForTask, rebindParentRun, storeHost } from './registry.js';

/**
 * T5 async parent enrichment. The sync ceiling (snapshot tools) stands first;
 * this pass narrows it to parent ∩ role ∩ revocation plus frozen MCP proxies
 * and memory search. Failures keep the narrower sync ceiling, never widen.
 */

export type CeilingHandle = {
  update(ceiling: { allowedTools: string[]; allowedAgents: string[] }): void;
};

/**
 * Narrows the ceiling and host after the sync registrations land.
 * `allowedAgents` are the runtime agents the session registered.
 */
export async function enrichParentAsync(
  deps: SessionFactoryDeps,
  taskId: string,
  runId: string,
  ceiling: CeilingHandle,
  allowedAgents: string[],
): Promise<void> {
  try {
    const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
    const frozen = await loadRunRole(profile, runId);
    const run = deps.ctx.ledger.run(taskId, runId);
    const roleAllows = frozen?.role.allows.tools ?? [...run.snapshot.tools];
    const revoked = frozen?.capabilities.revokedTools ?? [];
    const proxies = await listMcpProxies(deps.ctx, taskId, runId, deps.audit);
    const { allowedTools } = intersectChildTools({
      parentTools: run.snapshot.tools,
      roleAllowsTools: roleAllows,
      revokedTools: revoked,
      mcpProxies: proxies,
      runMemory: run.snapshot.memory,
    });
    ceiling.update({ allowedTools, allowedAgents });
    const host = hostForTask(taskId);
    if (host) storeHost(taskId, { ...host, allowedTools, mcpProxies: proxies });
    rebindParentRun(taskId, runId, run.snapshot.tools);
    await enrichMemoryAsync(deps, taskId, runId);
  } catch {
    // Enrichment never widens: the sync ceiling (snapshot tools) stands.
  }
}

async function listMcpProxies(
  ctx: RunnerContext,
  taskId: string,
  runId: string,
  audit: (entry: Record<string, unknown>) => void,
): Promise<string[]> {
  try {
    const serviceId = await readServiceId(ctx.paths);
    const authority = await McpAuthority.authorityFor({
      serviceId,
      dataDir: ctx.paths.root,
      cwd: ctx.paths.root,
      events: ctx.events,
      confirms: ctx.confirms,
      resources: new ResourceStore(ctx.ledger, ctx.paths),
      log: ctx.log,
    });
    const { bindings } = await authority.prepareRunnerTools({
      taskId,
      runId: () => runId,
      executionId: () => `root:${runId}`,
      audit,
      log: ctx.log,
    });
    return bindings.map((binding) => binding.proxyName);
  } catch {
    // Enrichment never widens: without a list the child ceiling holds no MCP proxies.
    return [];
  }
}

async function enrichMemoryAsync(
  deps: SessionFactoryDeps,
  taskId: string,
  runId: string,
): Promise<void> {
  const run = deps.ctx.ledger.run(taskId, runId);
  if (!run.snapshot.memory) return;
  try {
    const authority = await MemoryAuthority.authorityFor(deps.ctx.paths.agentDir, {
      notify: () => undefined,
      changed: () => undefined,
    });
    const factory = childMemoryProxy(authority, {
      runMemory: true,
      executionId: `child:${runId}:0`,
      taskId,
      runId,
    });
    const host = hostForTask(taskId);
    if (host) storeHost(taskId, { ...host, memoryFactory: factory as (pi: unknown) => void });
  } catch {
    // Memory stays unavailable rather than creating a second store.
  }
}
