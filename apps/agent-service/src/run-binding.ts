import {
  CODEMODE_TOOL,
  CONFIGURE_MCP_TOOL,
  LIST_MCP_TOOL,
  LOAD_SKILL_TOOL,
  MEMORY_TOOLS,
  TODO_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type TaskRun,
} from '@atd/agent-contracts';
import { MCP_RESOURCE_TOOLS } from './mcp/index.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { prepareSessionMcp, type SessionMcpPrep } from './pi-session-mcp.js';
import { skillProfilePaths } from './skills/profile.js';
import { effectiveTaskTier } from './tasks/tier.js';
import { loadRunRole } from './skills/roles.js';
import type { RuntimeAgent } from './subagents/agents.js';

/**
 * Service tools every parent run keeps beside its snapshot tools. Roles do not grant them;
 * subagent children inherit only the web tools (subagents/intersection.ts). The harness
 * registers the feature tools (harness/index.ts). `codemode` (codemode/extension.ts) scripts
 * reach only tools this allowlist registers, and only those pi's exposure makes callable.
 */
const SERVICE_TOOLS = [
  'ask_user',
  CODEMODE_TOOL,
  'desktop',
  CONFIGURE_MCP_TOOL,
  LIST_MCP_TOOL,
  TODO_TOOL,
  WEB_SEARCH_TOOL,
  WEB_FETCH_TOOL,
];

/**
 * The delegator tool pi-subagents registers on the parent. What its children
 * may use stays under the run's role ceiling, which the parent registers at
 * session_start (subagents/delegator.ts, enrich.ts).
 */
const SUBAGENT_TOOL = 'subagent';

/**
 * Pi's tool search (`createToolSearchExtension`, pi-session.ts). It is allowlisted, which declares
 * it, only when a bound MCP server is deferred. Deferred proxies are allowlisted too, so the
 * search may load them; pi-session.ts keeps them undeclared until it does (`declaredTools`).
 */
export const TOOL_SEARCH_TOOL = 'tool_search';

/**
 * What one run needs from the parent Pi session it executes in. Pi fixes all
 * of it when a session is built: the MCP proxies the extension factory
 * registers, the tool allowlist, and the subagent parent registration made at
 * session_start (role ceiling, memory, the runtime agents it may delegate to).
 * A live session is never reloaded, so it serves a later run only while that
 * run's key matches; any change means a new session on the same session file.
 * Skills are not part of it: each run brings its captured skills in its own
 * hidden message (skills/session-skills.ts), so a different skill selection
 * reuses the session. Only whether the run's skill catalog lists a loadable
 * skill is, through the `load_skill` tool (skills/load-skill-tool.ts).
 */
export interface RunBinding {
  /** Identity of everything above; equal keys mean an equal Pi session. */
  key: string;
  /** Pi's tool allowlist. Pi drops any registered tool outside it, extension tools included. */
  tools: string[];
  /** MCP proxies bound from this run's frozen selection and the current catalog. */
  mcp: SessionMcpPrep;
  /** The runtime agents the session registers: enabled service agents and referenced specialists. */
  agents: RuntimeAgent[];
}

/**
 * Reads a run's frozen role and MCP records into its session binding, with
 * the runtime agents resolved at freeze (run-freeze.ts). The runner sets the
 * run's material, with its frozen skill catalog, before it binds the run.
 */
export async function prepareRunBinding(
  deps: SessionFactoryDeps,
  run: TaskRun,
  agents: RuntimeAgent[],
): Promise<RunBinding> {
  const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
  const role = await loadRunRole(profile, run.id);
  const mcp = await prepareSessionMcp(deps);
  const loadable = deps.currentMaterial().catalog.invocable.length > 0;
  const deferred = mcp.bindings.some((binding) => binding.exposure === 'deferred');
  // Memory tools follow the frozen memory flag and `load_skill` the catalog; `tools` is in the key.
  const tools = [
    ...new Set([
      ...run.snapshot.tools,
      ...SERVICE_TOOLS,
      ...(run.snapshot.memory ? MEMORY_TOOLS : []),
      ...(loadable ? [LOAD_SKILL_TOOL] : []),
      SUBAGENT_TOOL,
      ...mcp.bindings.map((binding) => binding.proxyName),
      ...(deferred ? [TOOL_SEARCH_TOOL] : []),
      ...(mcp.resourceServers.length ? MCP_RESOURCE_TOOLS : []),
    ]),
  ];
  // The session's tool host freezes the task's tier (pi-session.ts), so a changed tier reopens it.
  const key = JSON.stringify({
    tier: effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier),
    tools,
    // Everything pi registers for a proxy (its annotations, exposure and namespace, which carries
    // the server's instructions) and the `mcp_servers` section renders, so any change reopens it.
    mcp: mcp.bindings.map((binding) => [
      binding.proxyName,
      binding.revision,
      binding.ref,
      binding.annotations ?? null,
      binding.exposure,
      binding.namespace,
    ]),
    mcpResources: mcp.resourceServers,
    role: role && [role.role.roleId, role.role.revision, role.capabilities.revokedTools],
    memory: run.snapshot.memory,
    agents: agents.map((agent) => [agent.name, agent.definition]),
  });
  return { key, tools, mcp, agents };
}
