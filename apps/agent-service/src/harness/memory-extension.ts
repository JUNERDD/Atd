import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { rootMemoryAuthority, rootMemoryProxy, rootMemoryScope } from '../memory/index.js';
import type { HarnessDeps } from './deps.js';

/**
 * Parent memory tools: `rootMemoryProxy` over the service MemoryAuthority when the run snapshot
 * enables memory, `null` otherwise. The proxy registers pi-hermes-memory's `memory_search`,
 * `memory_add`, `memory_replace` and `memory_remove` (MEMORY_TOOLS, allowlisted by the run
 * binding under the same flag). Learning stays on the authority's policy gate; its writes only
 * pass inside the turn scope task-runner.ts opens (memory/root-turn.ts). A store that cannot load
 * is logged and leaves the session without memory tools instead of failing the run.
 */
export async function memoryExtension(deps: HarnessDeps): Promise<ExtensionFactory | null> {
  const { run, runner } = deps;
  if (!run.snapshot.memory) return null;
  const authority = await rootMemoryAuthority({
    agentDir: runner.ctx.paths.agentDir,
    log: runner.ctx.log,
    taskId: runner.taskId,
  });
  // The scope's run only fixes the root execution and the memory flag, both part of the binding
  // key, so a session reused by a later run keeps the same policy.
  return authority && rootMemoryProxy(authority, rootMemoryScope(runner.taskId, run));
}
