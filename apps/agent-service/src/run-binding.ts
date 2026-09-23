import type { TaskRun } from '@ai/agent-contracts';
import type { SessionFactoryDeps } from './pi-session.js';
import { prepareSessionMcp, type SessionMcpPrep } from './pi-session-mcp.js';
import { skillProfilePaths } from './skills/profile.js';
import { loadRunRole } from './skills/roles.js';
import { loadRunSnapshot } from './skills/versions.js';
import type { RuntimeAgent } from './subagents/agents.js';

/** Service tools every parent run keeps beside its snapshot tools. */
const SERVICE_TOOLS = ['ask_user', 'desktop', 'configure_mcp'];

/**
 * The delegator tool pi-subagents registers on the parent. What its children
 * may use stays under the run's role ceiling, which the parent registers at
 * session_start (subagents/delegator.ts, enrich.ts).
 */
const SUBAGENT_TOOL = 'subagent';

/**
 * What one run needs from the parent Pi session it executes in. Pi fixes all
 * of it when a session is built: the resource loader's skill entries, the MCP
 * proxies the extension factory registers, the tool allowlist, and the
 * subagent parent registration made at session_start (role ceiling, memory,
 * the runtime agents it may delegate to). A live session is never reloaded,
 * so it serves a later run only while that run's key matches; any change
 * means a new session on the same session file.
 */
export interface RunBinding {
  /** Identity of everything above; equal keys mean an equal Pi session. */
  key: string;
  /** Pi's tool allowlist. Pi drops any registered tool outside it, extension tools included. */
  tools: string[];
  /** Frozen absolute skill entries for the resource loader; empty means no skills. */
  skillEntries: string[];
  /** MCP proxies bound from this run's frozen selection and the current catalog. */
  mcp: SessionMcpPrep;
  /** Referenced `~/.atd/agents` specialists registered beside the service agents. */
  agents: RuntimeAgent[];
}

/**
 * Reads a run's frozen skill, role and MCP records into its session binding,
 * with the atd agents its references resolved to at freeze.
 */
export async function prepareRunBinding(
  deps: SessionFactoryDeps,
  run: TaskRun,
  agents: RuntimeAgent[],
): Promise<RunBinding> {
  const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
  const skills = await loadRunSnapshot(profile, run.id);
  const role = await loadRunRole(profile, run.id);
  const mcp = await prepareSessionMcp(deps);
  const tools = [
    ...run.snapshot.tools,
    ...SERVICE_TOOLS,
    SUBAGENT_TOOL,
    ...mcp.bindings.map((binding) => binding.proxyName),
  ];
  const key = JSON.stringify({
    tools,
    skills: skills.skills.map((skill) => [skill.name, skill.revision, skill.entry]),
    mcp: mcp.bindings.map((binding) => [binding.proxyName, binding.revision, binding.ref]),
    role: role && [role.role.roleId, role.role.revision, role.capabilities.revokedTools],
    memory: run.snapshot.memory,
    agents: agents.map((agent) => [agent.name, agent.definition]),
  });
  return { key, tools, skillEntries: skills.skills.map((skill) => skill.entry), mcp, agents };
}
