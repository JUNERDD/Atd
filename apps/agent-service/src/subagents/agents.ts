import { createHash } from 'node:crypto';
import type { SubagentApproval, SubagentPermissions } from '@atd/agent-contracts';
import type { AtdAgent } from '../atd-agents/catalog.js';
import { CHILD_WEB_TOOLS } from './intersection.js';

/**
 * T5 runtime agents: the foreground-only agents a parent session may delegate to. Every run
 * registers every enabled catalog subagent, Personal (`~/.atd/agents`, atdRuntimeAgent) and plugin
 * (pluginRuntimeAgent), through atd-agents/run-agents.ts, and a parent's task agents
 * (task-agents.ts) register during its task; a session without either registers none. All are
 * pinned the same way (pinnedRuntimeDefinition), and a Settings permission override
 * (atd-agents/harness.ts) replaces a catalog agent's tools and approval from the next run. The
 * ceiling admits only the names a session registered, so packaged agents stay refused.
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
  /** pi-subagents' acceptance inference input; see `pinnedRuntimeDefinition`. */
  acceptanceRole: 'read-only';
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

/** What one runtime agent brings; `pinnedRuntimeDefinition` adds the service pins. */
interface RuntimeAgentFields {
  description: string;
  systemPrompt: string;
  /** Child tool allowlist; absent lets the service ceiling decide. */
  tools?: string[];
  thinking: string;
}

/**
 * A runtime agent definition carrying the service pins every agent has: fresh context, foreground,
 * depth 1, no extensions, and no project, global or skill context. pi-subagents receives exactly
 * these fields, so nothing a source file or a parent agent supplies can add another (a model, a
 * runner, extensions, permissions…). Without an acceptance role, pi-subagents appends an
 * "Acceptance Contract" to every child's task that asks for a code-change acceptance report; it
 * enforces nothing and contradicts roles that are not code work. Its documented `read-only` role
 * makes that inference `none` for every launch shape and changes no tool access, so children
 * answer in the format their role and task ask for.
 */
export function pinnedRuntimeDefinition(fields: RuntimeAgentFields): RuntimeAgentDefinition {
  return {
    description: fields.description,
    systemPrompt: fields.systemPrompt,
    ...(fields.tools ? { tools: fields.tools } : {}),
    extensions: [],
    inheritProjectContext: false,
    inheritGlobalContext: false,
    inheritSkills: false,
    defaultContext: 'fresh',
    defaultAsync: false,
    maxSubagentDepth: 1,
    acceptanceRole: 'read-only',
    thinking: fields.thinking,
  };
}

/**
 * Namespace for `~/.atd/agents` specialists. pi-subagents refuses
 * runtime names that collide with its builtins (`reviewer`, `scout`, …),
 * and the ceiling must never admit a builtin, so atd agents never register
 * under their bare names; `atd.` also keeps them apart from plugin and task agents.
 */
const ATD_AGENT_PREFIX = 'atd.';
/** Namespace for plugin subagents; see pluginRuntimeName. */
const PLUGIN_AGENT_PREFIX = 'plugin.';
/** pi-subagents' limit on runtime agent names. */
const MAX_RUNTIME_NAME = 128;

/** What a catalog specialist brings: its text, and its tool list (null lets the ceiling decide). */
interface SpecialistSource {
  description: string;
  systemPrompt: string;
  tools: readonly string[] | null;
}

/**
 * The runtime agent for a catalog specialist under `name`, with the service pins (fresh
 * context, foreground, depth 1, no extensions). Tools are the Settings override's, else the
 * source's; a list keeps the names within the run's child ceiling and the web tools
 * (subagents/intersection.ts), and no list lets the service ceiling decide.
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
      definition: pinnedRuntimeDefinition({
        description: source.description,
        systemPrompt: source.systemPrompt,
        ...(tools ? { tools } : {}),
        thinking: 'off',
      }),
    },
  };
}

/** The runtime agent a run registers for an enabled `~/.atd/agents` entry, as `atd.<name>`. */
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
 * `plugin.` keeps them apart from `atd.`, `task.` and pi-subagents' builtins. Past the runtime
 * name limit it is `plugin.<hash>`, which has a single `.` and so cannot equal a long form.
 */
export function pluginRuntimeName(plugin: string, item: string): string {
  const name = `${PLUGIN_AGENT_PREFIX}${plugin}.${item}`;
  if (name.length <= MAX_RUNTIME_NAME) return name;
  const hash = createHash('sha256').update(`${plugin}:${item}`).digest('hex').slice(0, 32);
  return `${PLUGIN_AGENT_PREFIX}${hash}`;
}

/** The runtime agent a run registers for an enabled plugin subagent (plugins/map.ts). */
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
