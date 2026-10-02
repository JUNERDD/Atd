import type { TSchema } from 'typebox';
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { inGrantedFolder } from '../folders/access.js';
import type { SessionFactoryDeps } from '../pi-session.js';
import { userAgentsReadRoots } from '../service-fs.js';
import type { ServicePaths } from '../storage.js';
import type { HarnessDeps } from './deps.js';
import { searchOperations } from './search/confine.js';
import { pathArgument, precheckSearch } from './search/tools.js';

/** What the search tools use of the harness deps: the task, its current run and the gate. */
export type SearchToolsDeps = Pick<HarnessDeps, 'cwd' | 'gate'> & {
  runner: Pick<SessionFactoryDeps, 'taskId' | 'currentRunId' | 'currentMaterial' | 'audit'> & {
    ctx: { paths: Pick<ServicePaths, 'root'> };
  };
};

/**
 * grep / find / ls: pi's built-in tools with confined pluggable operations. The names are
 * snapshot tools, so these registrations must exist whenever the binding allows them: they
 * shadow pi's own unconfined built-ins. Every call is confined to the task folder, `~/.agents`
 * with its linked skills (userAgentsReadRoots), or a folder granted to the task as the current
 * run started, as the read tool is (a path elsewhere throws before the gate). A task-folder call
 * passes the gate as `read:inside`, which no tier prompts for but every call is audited under; a
 * `~/.agents` call as `read:outside`, like a read there. A call inside a granted folder skips the
 * gate like a read there and is audited as `folder`. Children keep the task folder only
 * (search/tools.ts).
 */
export function searchToolsExtension(deps: SearchToolsDeps): ExtensionFactory {
  const folders = () => deps.runner.currentMaterial().folders.map((folder) => folder.path);
  const roots = async () => [...(await userAgentsReadRoots()), ...folders()];
  const operations = searchOperations(deps.cwd, roots);
  return (pi) => {
    pi.registerTool(
      gated(createGrepToolDefinition(deps.cwd, { operations: operations.grep }), deps, folders),
    );
    pi.registerTool(
      gated(createFindToolDefinition(deps.cwd, { operations: operations.find }), deps, folders),
    );
    pi.registerTool(
      gated(createLsToolDefinition(deps.cwd, { operations: operations.ls }), deps, folders),
    );
  };
}

function gated<T extends TSchema, D>(
  tool: ToolDefinition<T, D>,
  deps: SearchToolsDeps,
  folders: () => readonly string[],
): ToolDefinition<T, D> {
  return {
    ...tool,
    async execute(id, args, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const granted = folders();
      const extraRoots = [...(await userAgentsReadRoots()), ...granted];
      const location = await precheckSearch(deps.cwd, tool.name, args, extraRoots);
      const target = pathArgument(args) || '.';
      const dataDir = deps.runner.ctx.paths.root;
      // Searches recurse, so a path that holds the data dir keeps the gate (folders/access.ts).
      if (await inGrantedFolder(granted, dataDir, deps.cwd, target, tool.name !== 'ls')) {
        const runId = deps.runner.currentRunId();
        const base = { taskId: deps.runner.taskId, runId, toolCallId: id };
        deps.runner.audit({ ...base, tool: `${tool.name}:folder`, decision: 'folder' });
      } else
        await deps.gate({
          toolCallId: id,
          scope: { tool: 'read', location },
          title: `${tool.name}: ${(pathArgument(args) ?? '.').slice(0, 300)}`,
          detail: JSON.stringify({ tool: tool.name, args }),
          signal: signal ?? undefined,
        });
      // Pi's context goes through untouched: its `cwd` is `deps.cwd`, and a spread would drop its
      // non-enumerable `tools` and `executeTool` (see `controlled` in tool-proxies.ts).
      return tool.execute(id, args, signal, onUpdate, ctx);
    },
  };
}
