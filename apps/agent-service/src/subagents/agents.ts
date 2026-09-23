import type { AtdAgent } from '../atd-agents/catalog.js';

/**
 * T5 runtime agents. The service registers three foreground-only agents per
 * parent session; packaged agent names stay refused by the ceiling. Tools are
 * omitted so the service ceiling (parent ∩ role ∩ revocation) decides; the
 * agents pin context, async default, depth and extension isolation instead.
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
}

/**
 * Namespace for referenced `~/.atd/agents` specialists. pi-subagents refuses
 * runtime names that collide with its builtins (`reviewer`, `scout`, …),
 * and the ceiling must never admit a builtin, so atd agents never register
 * under their bare names; `atd.` also keeps them apart from `service.*`.
 */
const ATD_AGENT_PREFIX = 'atd.';
/** pi-subagents' limit on runtime agent names. */
const MAX_RUNTIME_NAME = 128;

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
  },
  {
    name: 'service.reviewer',
    definition: {
      description: 'Read-only review child returning findings with evidence.',
      systemPrompt:
        'You are the service reviewer child. Inspect only the assigned material and return findings with file and line evidence. Do not mutate files.',
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
  {
    name: 'service.scout',
    definition: {
      description: 'Read-only discovery child mapping code behavior.',
      systemPrompt:
        'You are the service scout child. Map only the requested behavior and return paths, symbols and brief notes. Do not mutate files.',
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
];

export function serviceAgentNames(): string[] {
  return SERVICE_RUNTIME_AGENTS.map((agent) => agent.name);
}

/**
 * The runtime agent a run registers for a referenced `~/.atd/agents` entry:
 * the file's description and prompt with the service pins (fresh context,
 * foreground, depth 1, no extensions). Tools are the file's list within the
 * run's child ceiling, or the whole ceiling when the file names none. The
 * file's `model` is never applied: the guard forbids per-call model
 * overrides, and a definition model would be one.
 */
export function atdRuntimeAgent(
  agent: AtdAgent,
  ceiling: readonly string[],
): { agent: RuntimeAgent } | { reason: string } {
  const name = `${ATD_AGENT_PREFIX}${agent.name}`;
  if (name.length > MAX_RUNTIME_NAME)
    return { reason: `its name is longer than ${MAX_RUNTIME_NAME - ATD_AGENT_PREFIX.length}` };
  // The catalog accepts NUL characters; pi-subagents refuses them at registration.
  if (agent.description.includes('\0') || agent.systemPrompt.includes('\0'))
    return { reason: 'its file contains a NUL character' };
  const tools = agent.tools.length
    ? agent.tools.filter((tool) => ceiling.includes(tool))
    : [...ceiling];
  return {
    agent: {
      name,
      definition: {
        description: agent.description,
        systemPrompt: agent.systemPrompt,
        tools,
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
