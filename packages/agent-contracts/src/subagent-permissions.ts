import { Type, type Static } from 'typebox';
import type { PermissionTier } from './confirms.js';
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL } from './tool-names.js';

/**
 * Tools a subagent's permissions can name: the service tools a child may inherit (read and
 * search, file changes, shell and saved commands) and the web tools. MCP proxies and memory
 * search are not nameable: a subagent that limits its tools gets neither, one that inherits the
 * task's tools gets whatever the task allows.
 */
export const SUBAGENT_TOOLS = [
  'read',
  'grep',
  'find',
  'ls',
  'write',
  'edit',
  'bash',
  'command',
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
] as const;
export type SubagentTool = (typeof SUBAGENT_TOOLS)[number];

export const SubagentToolSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('grep'),
  Type.Literal('find'),
  Type.Literal('ls'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
  Type.Literal(WEB_SEARCH_TOOL),
  Type.Literal(WEB_FETCH_TOOL),
]);

/**
 * A subagent's own approval tier. `always` is not offered: a child's tier is the stricter of the
 * task's and this one, so `always` could never change anything.
 */
export const SubagentApprovalSchema = Type.Union([Type.Literal('auto'), Type.Literal('manual')]);
export type SubagentApproval = Static<typeof SubagentApprovalSchema>;

/**
 * One catalog subagent's permissions. `tools` null inherits the task's tools; a list limits the
 * child to those names, which at run time still stay within the task's tools. `approval` null
 * keeps the task tier. An agent's defaults come from its definition or file; Settings stores a
 * whole override that replaces them from the next run, and removing it restores them.
 */
export const SubagentPermissionsSchema = Type.Object(
  {
    tools: Type.Union([
      Type.Array(SubagentToolSchema, { minItems: 1, maxItems: SUBAGENT_TOOLS.length }),
      Type.Null(),
    ]),
    approval: Type.Union([SubagentApprovalSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type SubagentPermissions = Static<typeof SubagentPermissionsSchema>;

const TIER_STRICTNESS: Record<PermissionTier, number> = { manual: 0, auto: 1, always: 2 };

/** The tier a child runs under: the task's, or the subagent's own when that asks more often. */
export function subagentTier(
  task: PermissionTier,
  approval: SubagentApproval | null,
): PermissionTier {
  if (!approval) return task;
  return TIER_STRICTNESS[approval] < TIER_STRICTNESS[task] ? approval : task;
}
