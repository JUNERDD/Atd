import { catalogRunAgent, type RunCatalogAgents } from '../atd-agents/run-agents.js';
import { clip, oneLine } from './conversation.js';

/** Characters of an agent description repeated in its delegation hint. */
const DESCRIPTION_CHARS = 400;

/** What an `@agent` reference adds to the run: its delegation hint and its audit record. */
export interface AgentHint {
  text: string;
  audit: Record<string, unknown>;
}

/**
 * Resolves an `@agent` reference against the catalog subagents the run registers whether or not
 * they are referenced (atd-agents/run-agents.ts): plugin subagents the run froze as effective, by
 * name and never by parsing it, and `~/.atd/agents` specialists Settings has not turned off. The
 * hint asks the parent to prefer the agent the user named. Answers why the agent is unavailable
 * otherwise: for a file that did not load, the catalog's diagnostic, which Settings shows as well.
 */
export function resolveAgentReference(name: string, agents: RunCatalogAgents): AgentHint | string {
  const entry = catalogRunAgent(agents, name);
  // A note is one line that supplies its own final period (references/material.ts).
  if (typeof entry === 'string') return oneLine(entry).replace(/\.$/, '');
  const { agent } = entry;
  // No list means the child gets whatever this run allows children (subagents/agents.ts).
  const tools = agent.definition.tools ?? null;
  const toolLine = !tools
    ? 'It uses the tools this run allows.'
    : tools.length
      ? `Its tools: ${tools.join(', ')}.`
      : 'It has no tools in this run.';
  const call = JSON.stringify({ agent: agent.name, task: '<what to do>', async: false });
  return {
    text: [
      `Agent "${agent.name}" (${entry.name} from ${entry.source}): ${clip(oneLine(entry.description), DESCRIPTION_CHARS)}`,
      `Prefer it for work that suits it, through the subagent tool: ${call}. ${toolLine}`,
    ].join('\n'),
    audit: {
      reference: 'agent',
      target: entry.name,
      decision: 'included',
      registeredAs: agent.name,
      tools: tools ?? 'run',
      approval: agent.approval,
      ...entry.audit,
    },
  };
}
