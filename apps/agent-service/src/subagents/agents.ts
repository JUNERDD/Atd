import { createHash } from 'node:crypto';
import {
  WEB_FETCH_TOOL,
  WEB_SEARCH_TOOL,
  type SubagentApproval,
  type SubagentPermissions,
  type SubagentTool,
} from '@atd/agent-contracts';
import type { AtdAgent } from '../atd-agents/catalog.js';
import { CHILD_WEB_TOOLS } from './intersection.js';

/**
 * T5 runtime agents. The service registers three foreground-only agents per
 * parent session; packaged agent names stay refused by the ceiling. The worker
 * omits tools so the service ceiling (parent ∩ role ∩ revocation) decides; the
 * reviewer and scout name read-only lists, which pi-subagents intersects with
 * that ceiling, so they never widen it. All pin context, async default, depth
 * and extension isolation. A Settings permission override (atd-agents/harness.ts)
 * replaces an agent's tools and approval from the next run (withPermissions).
 * A run that references `~/.atd/agents` specialists registers those too
 * (atdRuntimeAgent), pinned the same way.
 */

export interface RuntimeAgentDefinition {
  description: string;
  systemPrompt: string;
  /** Child tool allowlist; absent lets the service ceiling decide. */
  tools?: string[];
  extensions: readonly string[];
  inheritProjectContext: boolean;
  inheritGlobalContext: boolean;
  inheritSkills: boolean;
  defaultContext: 'fresh';
  defaultAsync: boolean;
  maxSubagentDepth: number;
  thinking: string;
}

export interface RuntimeAgent {
  name: string;
  definition: RuntimeAgentDefinition;
  /**
   * The agent's own approval tier; null keeps the task's. A child runs under the stricter of the
   * two (delegator.ts). Stays out of the definition, which pi-subagents receives.
   */
  approval: SubagentApproval | null;
}

/**
 * Namespace for referenced `~/.atd/agents` specialists. pi-subagents refuses
 * runtime names that collide with its builtins (`reviewer`, `scout`, …),
 * and the ceiling must never admit a builtin, so atd agents never register
 * under their bare names; `atd.` also keeps them apart from `service.*`.
 */
const ATD_AGENT_PREFIX = 'atd.';
/** Namespace for referenced plugin subagents; see pluginRuntimeName. */
const PLUGIN_AGENT_PREFIX = 'plugin.';
/** pi-subagents' limit on runtime agent names. */
const MAX_RUNTIME_NAME = 128;

/**
 * Tools that inspect without mutating: the confined read and search tools the child bridge
 * registers (child-tools.ts). MCP proxies stay out because their servers may write.
 */
const READ_ONLY_TOOLS: SubagentTool[] = ['read', 'grep', 'find', 'ls'];

export const SERVICE_RUNTIME_AGENTS: RuntimeAgent[] = [
  {
    name: 'service.worker',
    definition: {
      description: 'Bounded implementation child for one foreground task.',
      systemPrompt:
        'You are the service worker child. Implement only the assigned task with the available tools. Keep edits minimal and report what changed.',
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
    approval: null,
  },
  {
    name: 'service.reviewer',
    definition: {
      description: 'Read-only review child returning findings with evidence.',
      systemPrompt:
        'You are the service reviewer child. Inspect only the assigned material and return findings with file and line evidence. Do not mutate files.',
      tools: READ_ONLY_TOOLS,
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
    approval: null,
  },
  {
    name: 'service.scout',
    definition: {
      description:
        'Read-only discovery child: maps code behavior or researches the web, returning sources.',
      systemPrompt:
        'You are the service scout child. Investigate only the requested question, in the task files or on the web, and return findings with their paths, symbols or source URLs and brief notes. Do not mutate files.',
      tools: [...READ_ONLY_TOOLS, WEB_SEARCH_TOOL, WEB_FETCH_TOOL],
      extensions: [],
      inheritProjectContext: false,
      inheritGlobalContext: false,
      inheritSkills: false,
      defaultContext: 'fresh',
      defaultAsync: false,
      maxSubagentDepth: 1,
      thinking: 'off',
    },
    approval: null,
  },
];

export function serviceAgentNames(): string[] {
  return SERVICE_RUNTIME_AGENTS.map((agent) => agent.name);
}

/**
 * A system agent with its Settings override applied: the override's tools replace the
 * definition's (null inherits the ceiling) and its approval is kept beside the definition.
 */
export function withPermissions(
  agent: RuntimeAgent,
  permissions: SubagentPermissions | undefined,
): RuntimeAgent {
  if (!permissions) return agent;
  const { tools: _defaultTools, ...definition } = agent.definition;
  return {
    ...agent,
    definition: permissions.tools ? { ...definition, tools: [...permissions.tools] } : definition,
    approval: permissions.approval,
  };
}

/** What a referenced specialist brings: its text, and its tool list (null lets the ceiling decide). */
interface SpecialistSource {
  description: string;
  systemPrompt: string;
  tools: readonly string[] | null;
}

/**
 * The runtime agent for a referenced specialist under `name`, with the service pins (fresh
 * context, foreground, depth 1, no extensions). Tools are the Settings override's, else the
 * source's; a list keeps the names within the run's child ceiling and the web tools
 * (subagents/intersection.ts), and no list lets the service ceiling decide, as for the worker.
 * A source `model` is never applied: the guard forbids per-call model overrides, and a
 * definition model would be one.
 */
function specialistRuntimeAgent(
  name: string,
  source: SpecialistSource,
  ceiling: readonly string[],
  permissions: SubagentPermissions | undefined,
): { agent: RuntimeAgent } | { reason: string } {
  // Sources accept NUL characters; pi-subagents refuses them at registration.
  if (source.description.includes('\0') || source.systemPrompt.includes('\0'))
    return { reason: 'its definition contains a NUL character' };
  const listed = permissions ? permissions.tools : source.tools;
  const tools = listed?.filter((tool) => ceiling.includes(tool) || CHILD_WEB_TOOLS.includes(tool));
  return {
    agent: {
      name,
      approval: permissions?.approval ?? null,
      definition: {
        description: source.description,
        systemPrompt: source.systemPrompt,
        ...(tools ? { tools } : {}),
        extensions: [],
        inheritProjectContext: false,
        inheritGlobalContext: false,
        inheritSkills: false,
        defaultContext: 'fresh',
        defaultAsync: false,
        maxSubagentDepth: 1,
        thinking: 'off',
      },
    },
  };
}

/** The runtime agent a run registers for a referenced `~/.atd/agents` entry, as `atd.<name>`. */
export function atdRuntimeAgent(
  agent: AtdAgent,
  ceiling: readonly string[],
  permissions?: SubagentPermissions,
): { agent: RuntimeAgent } | { reason: string } {
  const name = `${ATD_AGENT_PREFIX}${agent.name}`;
  if (name.length > MAX_RUNTIME_NAME)
    return { reason: `its name is longer than ${MAX_RUNTIME_NAME - ATD_AGENT_PREFIX.length}` };
  const tools = agent.tools.length ? agent.tools : null;
  return specialistRuntimeAgent(name, { ...agent, tools }, ceiling, permissions);
}

/**
 * The runtime name of a plugin subagent `<plugin>:<item>`: `plugin.<plugin>.<item>`. Item names
 * contain no `.`, so the last `.` separates the parts and no two plugin agents share a name;
 * `plugin.` keeps them apart from `atd.`, `service.` and pi-subagents' builtins. Past the runtime
 * name limit it is `plugin.<hash>`, which has a single `.` and so cannot equal a long form.
 */
export function pluginRuntimeName(plugin: string, item: string): string {
  const name = `${PLUGIN_AGENT_PREFIX}${plugin}.${item}`;
  if (name.length <= MAX_RUNTIME_NAME) return name;
  const hash = createHash('sha256').update(`${plugin}:${item}`).digest('hex').slice(0, 32);
  return `${PLUGIN_AGENT_PREFIX}${hash}`;
}

/** The runtime agent a run registers for a referenced plugin subagent (plugins/map.ts). */
export function pluginRuntimeAgent(
  agent: { pluginId: string; localName: string } & SpecialistSource,
  ceiling: readonly string[],
  permissions?: SubagentPermissions,
): { agent: RuntimeAgent } | { reason: string } {
  const name = pluginRuntimeName(agent.pluginId, agent.localName);
  return specialistRuntimeAgent(name, agent, ceiling, permissions);
}

/**
 * Registers runtime agents on one parent ExtensionAPI; the returned handle
 * releases them all. A refused registration releases the ones before it and
 * rethrows, so a session never keeps a partial agent set.
 */
export function registerRuntimeAgents(
  pi: unknown,
  agents: readonly RuntimeAgent[],
  register: (input: { pi: unknown; name: string; definition: RuntimeAgentDefinition }) => {
    dispose(): void;
  },
): { dispose(): void } {
  const handles: { dispose(): void }[] = [];
  const dispose = () => {
    for (const handle of handles.splice(0)) handle.dispose();
  };
  try {
    for (const agent of agents)
      handles.push(register({ pi, name: agent.name, definition: agent.definition }));
  } catch (error) {
    dispose();
    throw error;
  }
  return { dispose };
}
