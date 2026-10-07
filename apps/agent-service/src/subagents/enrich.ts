import type { SessionFactoryDeps } from '../pi-session.js';
import { logMemoryEvents, MemoryAuthority } from '../memory/index.js';
import { memoryTools } from '../memory/tools.js';
import { skillProfilePaths } from '../skills/profile.js';
import { loadRunRole } from '../skills/roles.js';
import { intersectChildTools } from './intersection.js';
import { hostForTask, storeHost } from './registry.js';

/**
 * T5 async parent enrichment. The sync ceiling (snapshot tools) stands first;
 * this pass narrows it to parent ∩ role ∩ revocation plus frozen MCP proxies
 * and the memory read tools. Failures keep the narrower sync ceiling, never widen.
 */

/** The child tool ceiling this narrows; task-agents.ts owns it with the session's agents. */
export interface ChildToolCeiling {
  narrowTools(allowedTools: readonly string[]): void;
}

/**
 * Narrows the child tools of the ceiling and host once the sync registrations landed. `mcpTools`
 * are the MCP tools the run binding froze (pi-session-mcp.ts `SessionMcpPrep.tools`), the same
 * ones the parent has. The session start awaits it, so task agents replay and validate against
 * the narrowed tools. It leaves the parent record alone: the run binding is lifecycle.ts's, and a
 * reset here would drop the delegation the guard admitted. Never throws.
 */
export async function narrowChildCeiling(
  deps: SessionFactoryDeps,
  taskId: string,
  runId: string,
  ceiling: ChildToolCeiling,
  mcpTools: readonly string[],
): Promise<void> {
  try {
    const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
    const frozen = await loadRunRole(profile, runId);
    const run = deps.ctx.ledger.run(taskId, runId);
    const roleAllows = frozen?.role.allows.tools ?? [...run.snapshot.tools];
    const revoked = frozen?.capabilities.revokedTools ?? [];
    const { allowedTools } = intersectChildTools({
      parentTools: run.snapshot.tools,
      roleAllowsTools: roleAllows,
      revokedTools: revoked,
      mcpTools,
      runMemory: run.snapshot.memory,
    });
    ceiling.narrowTools(allowedTools);
  } catch {
    // Enrichment never widens: the sync ceiling (snapshot tools) stands.
  }
}

/**
 * Gives the child host the memory read tools when the run has memory. Never throws: the session
 * start does not wait for it.
 */
export async function enrichMemoryAsync(
  deps: SessionFactoryDeps,
  taskId: string,
  runId: string,
): Promise<void> {
  try {
    if (!deps.ctx.ledger.run(taskId, runId).snapshot.memory) return;
    const { agentDir } = deps.ctx.paths;
    const store = await MemoryAuthority.authorityFor(agentDir, logMemoryEvents(deps.ctx.log));
    // Children read memory and never write it: the read tools only, each under its child's
    // execution id, which the authority never lets learn.
    const factory = (child: { runId: string; executionId: string }) =>
      memoryTools({
        store,
        scope: () => ({
          runMemory: true,
          executionId: child.executionId,
          taskId,
          runId: child.runId,
        }),
        readOnly: true,
      }) as (pi: unknown) => void;
    const host = hostForTask(taskId);
    if (host) storeHost(taskId, { ...host, memoryFactory: factory });
  } catch {
    // Memory stays unavailable rather than creating a second store.
  }
}
