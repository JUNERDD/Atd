import { SUBAGENT_TOOLS, type SubagentPermissions, type SubagentTool } from '@atd/agent-contracts';

/**
 * Subagent permissions as Settings shows and stores them. An agent's defaults come from its file
 * (`~/.atd/agents`) or its plugin's definition; an override replaces them whole from the next run
 * (subagents/agents.ts `atdRuntimeAgent`, `pluginRuntimeAgent`). An override equal to the
 * defaults is not kept, so "customized" always means it changes something.
 */

function isSubagentTool(tool: string): tool is SubagentTool {
  return (SUBAGENT_TOOLS as readonly string[]).includes(tool);
}

/** Tool lists in catalog order without repeats; comparisons and the stored file rely on it. */
function canonicalTools(tools: readonly string[]): SubagentTool[] {
  return SUBAGENT_TOOLS.filter((tool) => tools.includes(tool));
}

/**
 * An agent's defaults: its own tool list (null when it names none and so inherits the task's)
 * and the task's approval. A file tool outside the nameable set is dropped here as the run drops
 * it at the ceiling.
 */
export function defaultPermissions(tools: readonly string[] | undefined): SubagentPermissions {
  const named = (tools ?? []).filter(isSubagentTool);
  return { tools: named.length ? canonicalTools(named) : null, approval: null };
}

function samePermissions(a: SubagentPermissions, b: SubagentPermissions): boolean {
  if (a.approval !== b.approval) return false;
  if (!a.tools || !b.tools) return a.tools === b.tools;
  return a.tools.length === b.tools.length && a.tools.every((tool, i) => tool === b.tools?.[i]);
}

/** The override to store for a Settings save: canonical, or null when it equals the defaults. */
export function overrideToStore(
  requested: SubagentPermissions,
  defaults: SubagentPermissions,
): SubagentPermissions | null {
  const normalized = {
    tools: requested.tools ? canonicalTools(requested.tools) : null,
    approval: requested.approval,
  };
  return samePermissions(normalized, defaults) ? null : normalized;
}

/** What a catalog row reports: the permissions later runs use and whether Settings changed them. */
export function effectivePermissions(
  defaults: SubagentPermissions,
  override: SubagentPermissions | undefined,
): { permissions: SubagentPermissions; customized: boolean } {
  return { permissions: override ?? defaults, customized: override !== undefined };
}
