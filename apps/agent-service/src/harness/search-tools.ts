import type { TSchema } from 'typebox';
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  type ExtensionFactory,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { HarnessDeps } from './deps.js';
import { searchOperations } from './search/confine.js';
import { pathArgument, precheckSearch } from './search/tools.js';

/**
 * grep / find / ls: pi's built-in tools with confined pluggable operations. The names are
 * snapshot tools, so these registrations must exist whenever the binding allows them: they
 * shadow pi's own unconfined built-ins. Every call is confined to the task folder (a path
 * outside throws before the gate) and passes the gate as `read:inside`, which no tier prompts
 * for but every call is audited under.
 */
export function searchToolsExtension(deps: HarnessDeps): ExtensionFactory {
  const operations = searchOperations(deps.cwd);
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
      await precheckSearch(deps.cwd, tool.name, args);
      await deps.gate({
        toolCallId: id,
        scope: { tool: 'read', location: 'inside' },
        title: `${tool.name}: ${(pathArgument(args) ?? '.').slice(0, 300)}`,
        detail: JSON.stringify({ tool: tool.name, args }),
        signal: signal ?? undefined,
      });
      return tool.execute(id, args, signal, onUpdate, { ...ctx, cwd: deps.cwd });
    },
  };
}
