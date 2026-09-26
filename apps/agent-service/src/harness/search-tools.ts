import type { TSchema } from 'typebox';
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { userAgentsReadRoots } from '../service-fs.js';
import type { HarnessDeps } from './deps.js';
import { searchOperations } from './search/confine.js';
import { pathArgument, precheckSearch } from './search/tools.js';

/**
 * grep / find / ls: pi's built-in tools with confined pluggable operations. The names are
 * snapshot tools, so these registrations must exist whenever the binding allows them: they
 * shadow pi's own unconfined built-ins. Every call is confined to the task folder or
 * `~/.agents` with its linked skills (userAgentsReadRoots), as the read tool is (a path
 * elsewhere throws before the gate). A task-folder call passes the gate as `read:inside`, which
 * no tier prompts for but every call is audited under; a `~/.agents` call as `read:outside`,
 * like a read there. Children keep the task folder only (search/tools.ts).
 */
export function searchToolsExtension(deps: HarnessDeps): ExtensionFactory {
  const operations = searchOperations(deps.cwd, userAgentsReadRoots);
  return (pi) => {
    pi.registerTool(
      gated(createGrepToolDefinition(deps.cwd, { operations: operations.grep }), deps),
    );
    pi.registerTool(
      gated(createFindToolDefinition(deps.cwd, { operations: operations.find }), deps),
    );
    pi.registerTool(gated(createLsToolDefinition(deps.cwd, { operations: operations.ls }), deps));
  };
}

function gated<T extends TSchema, D>(
  tool: ToolDefinition<T, D>,
  deps: HarnessDeps,
): ToolDefinition<T, D> {
  return {
    ...tool,
    async execute(id, args, signal, onUpdate, ctx) {
      signal?.throwIfAborted();
      const location = await precheckSearch(deps.cwd, tool.name, args, await userAgentsReadRoots());
      await deps.gate({
        toolCallId: id,
        scope: { tool: 'read', location },
        title: `${tool.name}: ${(pathArgument(args) ?? '.').slice(0, 300)}`,
        detail: JSON.stringify({ tool: tool.name, args }),
        signal: signal ?? undefined,
      });
      return tool.execute(id, args, signal, onUpdate, { ...ctx, cwd: deps.cwd });
    },
  };
}
