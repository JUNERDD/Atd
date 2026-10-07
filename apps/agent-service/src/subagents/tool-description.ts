import { TASK_AGENT_PREFIX, TASK_AGENTS_PER_DEFINE } from '@atd/agent-contracts';
import { SUBAGENT_CONCURRENCY } from './config.js';
import { DEFINE_AGENTS_SHAPE } from './task-agent-definition.js';
import { SUBAGENT_CHILDREN_PER_CALL } from './tool-contract.js';

/**
 * The model-facing description of the `subagent` tool: the call shapes the guard admits, when and
 * how to delegate, and a bounded catalog of the agents the session registered. It is built once
 * per session, from the agents its run binding froze, so it stays the same for the session's life
 * and the parent's prompt cache keeps it; the task agents a parent defines come back in the define
 * result and in `list` instead.
 */

/** Most agents the catalog names; `list` shows the rest. */
const CATALOG_MAX_AGENTS = 16;
/** Longest catalog description, in characters. */
const CATALOG_DESCRIPTION_MAX_LENGTH = 100;

/** An agent the catalog names: its runtime name and its definition's description. */
export interface CatalogAgent {
  name: string;
  definition: { description: string };
}

const GUIDANCE = [
  'Delegate bounded work to child subagents. Children start with fresh context: they do not see this conversation, cannot delegate further, and return their result to you.',
  '',
  'Pass exactly one of these shapes:',
  '- One child: { agent, task }',
  '- Several children at the same time: { tasks: [{ agent, task }, ...] }',
  '- Children in order: { chain: [{ agent, task }, { agent, task }, ...] }. Every step after the first receives the previous step’s output: place it with {previous} in the task, otherwise it is appended. A step may also run children at the same time, { parallel: [{ agent, task }, ...] }; the next step then receives all of their outputs.',
  `- Define task agents: { action: "define", agents: ${DEFINE_AGENTS_SHAPE} }, at most ${TASK_AGENTS_PER_DEFINE} per call.`,
  '- Inspect: { action: "list", capabilities: true } lists the agents you may call with their tools; { action: "status", id } reports a run.',
  '',
  'How to delegate:',
  '- Delegate only work that splits into independent parts, bulky work whose intermediate output should stay out of your context, or an independent review. Do small or strictly sequential work yourself: one lookup needs no child, a comparison takes 2-4, more only for large work that truly splits.',
  '- Agents are reusable templates: choose one by capability, not by the number of parts. The same agent can appear several times in one tasks call.',
  `- When no agent fits, define a task agent, then launch it as ${TASK_AGENT_PREFIX}<name> in a later message. Its instructions state the scope, quality standards, output format and acceptance criteria rather than a persona. Give it only the tools the work needs, and more thinking for hard reasoning (at most your own level, which is the default). A definition lasts for this task and cannot change: define a new name for a different role.`,
  '- Make each task self-contained: the goal and why, the input material, the scope and what to leave out, the output format and length, and when it is done. The child sees nothing else.',
  '- When correctness matters (calculations, facts, code behavior), add a chain step that verifies the work against explicit criteria, and run a check yourself when you can. A verifier judges correctness and the stated requirements only.',
  '- Treat child results as claims: check them before you use them.',
  '',
  'Rules:',
  '- Every launch runs in the foreground and returns when its children finish; async:true is refused.',
  '- Launch at most one subagent call at a time: a second launch while one runs is rejected, so put independent work in one tasks call.',
  `- One call runs at most ${SUBAGENT_CHILDREN_PER_CALL} children, counting every task and chain step, and at most ${SUBAGENT_CONCURRENCY} of them at the same time.`,
  '- If any child fails, the call fails, but the results of the children that finished still come back; a chain stops at the step that failed.',
  '- agent must name an agent of this session (the ones below; list shows them all) or a task agent you defined.',
];

/** One catalog line: the agent's name and the first line of its description, bounded. */
function catalogLine(agent: CatalogAgent): string {
  const [first = ''] = agent.definition.description.split('\n');
  const text = first.replace(/\s+/g, ' ').trim();
  const clipped =
    text.length > CATALOG_DESCRIPTION_MAX_LENGTH
      ? `${text.slice(0, CATALOG_DESCRIPTION_MAX_LENGTH - 1).trimEnd()}…`
      : text;
  return clipped ? `- ${agent.name}: ${clipped}` : `- ${agent.name}`;
}

/** The `subagent` tool description for a session whose run binding registers `agents`. */
export function subagentToolDescription(agents: readonly CatalogAgent[]): string {
  const shown = agents.slice(0, CATALOG_MAX_AGENTS);
  const more = agents.length - shown.length;
  return [
    ...GUIDANCE,
    '',
    'Agents in this session:',
    ...(shown.length ? shown.map(catalogLine) : ['- none; define a task agent']),
    ...(more > 0 ? [`- and ${more} more; { action: "list" } shows every agent`] : []),
  ].join('\n');
}
