import type { AtdAgent } from '../atd-agents/catalog.js';
import { atdRuntimeAgent, pluginRuntimeAgent, type RuntimeAgent } from '../subagents/agents.js';
import { clip, oneLine } from './conversation.js';
import type { ReferenceContext } from './material.js';

/** Characters of an agent description repeated in its delegation hint. */
const DESCRIPTION_CHARS = 400;

/** A referenced agent the run registers, with its delegation hint and audit record. */
export interface AgentHint {
  agent: RuntimeAgent;
  text: string;
  audit: Record<string, unknown>;
}

/**
 * Resolves an `@agent` reference: first against the plugin subagents the run froze as effective
 * (by name, never by parsing it), then against `~/.atd/agents` unless Settings turned the agent
 * off. Answers the hint, or why the agent is unavailable.
 */
export async function resolveAgentReference(
  name: string,
  context: Pick<
    ReferenceContext,
    'toolCeiling' | 'agentPermissions' | 'disabledAgents' | 'pluginAgents'
  >,
  catalog: Promise<AtdAgent[] | string>,
): Promise<AgentHint | string> {
  const permissions = context.agentPermissions.get(name);
  const agent = context.pluginAgents.get(name);
  if (agent) {
    const runtime = pluginRuntimeAgent(agent, context.toolCeiling, permissions);
    return agentHint(agent, runtime, `plugin ${agent.pluginId}`, {});
  }
  if (context.disabledAgents.has(name)) return 'it is turned off in Settings';
  const entries = await catalog;
  if (typeof entries === 'string') return entries;
  const entry = entries.find((agent) => agent.name === name);
  if (!entry) return 'it is not in ~/.atd/agents or an enabled plugin';
  const runtime = atdRuntimeAgent(entry, context.toolCeiling, permissions);
  return agentHint(entry, runtime, '~/.atd/agents', { ignoredModel: entry.model });
}

function agentHint(
  entry: { name: string; description: string },
  runtime: { agent: RuntimeAgent } | { reason: string },
  source: string,
  audit: Record<string, unknown>,
): AgentHint | string {
  if ('reason' in runtime) return runtime.reason;
  const { agent } = runtime;
  // No list means the child gets whatever this run allows children (subagents/agents.ts).
  const tools = agent.definition.tools ?? null;
  const toolLine = !tools
    ? 'It uses the tools this run allows.'
    : tools.length
      ? `Its tools: ${tools.join(', ')}.`
      : 'It has no tools in this run.';
  const call = JSON.stringify({ agent: agent.name, task: '<what to do>', async: false });
  return {
    agent,
    text: [
      `Agent "${agent.name}" (${entry.name} from ${source}): ${clip(oneLine(entry.description), DESCRIPTION_CHARS)}`,
      `Delegate work that suits it with the subagent tool: ${call}. ${toolLine}`,
    ].join('\n'),
    audit: {
      reference: 'agent',
      target: entry.name,
      decision: 'included',
      registeredAs: agent.name,
      tools: tools ?? 'run',
      approval: agent.approval,
      ...audit,
    },
  };
}
