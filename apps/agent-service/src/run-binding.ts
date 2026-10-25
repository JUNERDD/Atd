import {
  AUTOMATION_TOOL,
  CODEMODE_TOOL,
  COMPUTER_TOOL,
  CONFIGURE_MCP_TOOL,
  LIST_MCP_TOOL,
  LOAD_SKILL_TOOL,
  MEMORY_READ_TOOLS,
  MEMORY_WRITE_TOOLS,
  SHOW_UI_TOOL,
  TODO_TOOL,
  UPDATE_UI_TOOL,
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type TaskRun,
} from '@atd/agent-contracts';
import { APP_TOOL } from './apps/tool-name.js';
import { isRestrictedComputerRun, restrictedComputerTools } from './computer/tool-set.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { prepareSessionMcp, type SessionMcpPrep } from './pi-session-mcp.js';
import { skillProfilePaths } from './skills/profile.js';
import { effectiveTaskTier } from './tasks/tier.js';
import { loadRunRole } from './skills/roles.js';
import type { RuntimeAgent } from './subagents/agents.js';

/**
 * Service tools every parent run keeps beside its snapshot tools. Roles do not grant them;
 * subagent children inherit only the web tools (subagents/intersection.ts), so `app` and
 * `automation` stay parent-only. The harness registers the feature tools (harness/index.ts).
 * `codemode` (codemode/extension.ts) scripts reach only tools this allowlist registers, and only
 * those pi's exposure makes callable.
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
  APP_TOOL,
  AUTOMATION_TOOL,
  SHOW_UI_TOOL,
  UPDATE_UI_TOOL,
];

/** Large management schemas load on demand; registration and permission checks stay unchanged. */
export const DEFERRED_SERVICE_TOOLS = ['command', AUTOMATION_TOOL];

/**
 * The delegator tool pi-subagents registers on the parent. What its children
 * may use stays under the run's role ceiling, which the parent registers at
 * session_start (subagents/delegator.ts, enrich.ts).
 */
const SUBAGENT_TOOL = 'subagent';

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
  /** The runtime agents the session registers: its enabled catalog subagents, possibly none. */
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
  const prepared = await prepareSessionMcp(deps);
  const material = deps.currentMaterial();
  const loadable = material.catalog.invocable.length > 0;
  // The freeze decided whether the run has the computer tool (attended setup or an authorized unattended scope).
  const { computer } = material;
  // An unattended computer run gets its exact tool set and no MCP: no proxy, resource tool or
  // `mcp_servers` section, so what the model is told, what pi keeps and what runs all agree.
  const restricted = isRestrictedComputerRun(run.snapshot);
  const mcp = restricted
    ? { ...prepared, factory: () => undefined, bindings: [], resourceServers: [], tools: [] }
    : prepared;
  // Memory tools follow the frozen memory flag and `load_skill` the catalog; `tools` is in the key.
  // An unattended run (an automation's, unattended.ts) may search and read memory but never
  // change it, so a person's follow-up in the same task gets a session with the write tools.
  const memoryTools = run.snapshot.trigger
    ? MEMORY_READ_TOOLS
    : [...MEMORY_READ_TOOLS, ...MEMORY_WRITE_TOOLS];
  const tools = restricted
    ? restrictedComputerTools(run.snapshot, { loadable, computer })
    : [
        ...new Set([
          ...run.snapshot.tools,
          ...SERVICE_TOOLS,
          // Attended runs retain setup guidance; targets remain scoped per run (computer/extension.ts).
          ...(computer ? [COMPUTER_TOOL] : []),
          ...(run.snapshot.memory ? memoryTools : []),
          ...(loadable ? [LOAD_SKILL_TOOL] : []),
          SUBAGENT_TOOL,
          ...mcp.tools,
        ]),
      ];
  const deferred = DEFERRED_SERVICE_TOOLS.filter((name) => tools.includes(name));
  if (deferred.length && !tools.includes('tool_search')) tools.push('tool_search');
  // The session's tool host freezes the task's tier (pi-session.ts), so a changed tier reopens it.
  const key = JSON.stringify({
    tier: effectiveTaskTier(deps.ctx.ledger, deps.taskId, deps.ctx.tier),
    tools,
    deferred,
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
    // The computer tool reads the run's targets and grant per call; the key still separates
    // sessions by them so a reused session never mixes computer scopes. Whether the tool exists at
    // all is in `tools`; attended sessions keep it as engine add-ons change live.
    computer: (computer && run.snapshot.computer) || null,
    // A child's approval binds once per session (subagents/approvals.ts), beside the definition.
    agents: agents.map((agent) => [agent.name, agent.definition, agent.approval]),
  });
  return { key, tools, mcp, agents };
}
