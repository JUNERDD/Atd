import {
  SUBAGENT_TOOLS,
  TASK_AGENT_DESCRIPTION_MAX_LENGTH,
  TASK_AGENT_INSTRUCTIONS_MAX_LENGTH,
  TASK_AGENT_NAME_PATTERN,
  TASK_AGENT_PREFIX,
  TASK_AGENTS_PER_DEFINE,
  isTaskAgent,
  taskAgentName,
  type SubagentTool,
  type TaskAgentDefinition,
  type ThinkingLevel,
} from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';
import { pinnedRuntimeDefinition, type RuntimeAgentDefinition } from './agents.js';
import { SUBAGENT_CHILD_SYSTEM_PROMPT } from './config.js';

/**
 * Task agent definitions: what a parent's `subagent { action: "define" }` call asks for, the
 * checks against the run it is defined or replayed in, and the runtime agent pi-subagents
 * registers for an accepted one. A task agent narrows what children of the run may already do:
 * its tools stay within the run's child tools, its thinking within the run's level, and it keeps
 * the task's approvals and model. Pure; task-agents.ts owns registration, records and replay.
 */

/** Pi's thinking levels by rank (`ThinkingLevelSchema`), lowest first. */
const THINKING_RANK: Readonly<Record<ThinkingLevel, number>> = {
  off: 0,
  minimal: 1,
  low: 2,
  medium: 3,
  high: 4,
  xhigh: 5,
  max: 6,
};

function isThinkingLevel(value: string): value is ThinkingLevel {
  return Object.hasOwn(THINKING_RANK, value);
}

/** Every thinking level, lowest first. */
export const THINKING_LEVELS: readonly ThinkingLevel[] = Object.keys(THINKING_RANK)
  .filter(isThinkingLevel)
  .sort((a, b) => THINKING_RANK[a] - THINKING_RANK[b]);

/** True when `level` thinks more than `ceiling` allows. */
export function thinksAbove(level: ThinkingLevel, ceiling: ThinkingLevel): boolean {
  return THINKING_RANK[level] > THINKING_RANK[ceiling];
}

/** One task agent a define call asks for, as the tool contract declares it (tool-contract.ts). */
export const TaskAgentRequestSchema = Type.Object(
  {
    name: Type.String({
      pattern: TASK_AGENT_NAME_PATTERN,
      description: `Lowercase letters, digits and hyphens, at most 40; it launches as ${TASK_AGENT_PREFIX}<name>.`,
    }),
    description: Type.String({
      minLength: 1,
      maxLength: TASK_AGENT_DESCRIPTION_MAX_LENGTH,
      description: 'When to use it, in one line.',
    }),
    instructions: Type.String({
      minLength: 1,
      maxLength: TASK_AGENT_INSTRUCTIONS_MAX_LENGTH,
      description: 'Its role: scope, quality standards, output format and acceptance criteria.',
    }),
    tools: Type.Array(Type.Enum([...SUBAGENT_TOOLS]), {
      maxItems: SUBAGENT_TOOLS.length,
      description:
        'Only the tools it needs, among the tools children have in this run; [] for none.',
    }),
    thinking: Type.Optional(
      Type.Enum([...THINKING_LEVELS], {
        description: 'Its thinking level, at most yours; yours when omitted.',
      }),
    ),
  },
  { additionalProperties: false },
);
export type TaskAgentRequest = Static<typeof TaskAgentRequestSchema>;

/** The shape of a define call's `agents`, as refusals name it. */
export const DEFINE_AGENTS_SHAPE = '[{ name, description, instructions, tools, thinking? }]';

/** The `agents` of one define call. */
export const TaskAgentRequestsSchema = Type.Array(TaskAgentRequestSchema, {
  minItems: 1,
  maxItems: TASK_AGENTS_PER_DEFINE,
  description: `define only: up to ${TASK_AGENTS_PER_DEFINE} task agents.`,
});
const TaskAgentRequests = Compile(TaskAgentRequestsSchema);

/** The `agents` of a define call, or null when they do not match the tool contract. */
export function parseTaskAgentRequests(value: unknown): TaskAgentRequest[] | null {
  return TaskAgentRequests.Check(value) ? value : null;
}

const NAME = new RegExp(TASK_AGENT_NAME_PATTERN);

/** True for a runtime name a define call can give: `task.` and a valid name. */
export function isTaskAgentName(agent: string): boolean {
  return isTaskAgent(agent) && NAME.test(agent.slice(TASK_AGENT_PREFIX.length));
}

/**
 * The definition a request asks for in a run: trimmed text (pi-subagents refuses surrounding
 * whitespace), its tools once each in `SUBAGENT_TOOLS` order, and the run's thinking level when
 * it names none. It is not checked against the run; see `definitionProblem`.
 */
export function requestedDefinition(
  request: TaskAgentRequest,
  runThinking: ThinkingLevel,
): TaskAgentDefinition {
  return {
    agent: taskAgentName(request.name),
    description: request.description.trim(),
    instructions: request.instructions.trim(),
    tools: SUBAGENT_TOOLS.filter((tool) => request.tools.includes(tool)),
    thinking: request.thinking ?? runThinking,
  };
}

/** True when two definitions describe the same task agent. */
export function sameDefinition(a: TaskAgentDefinition, b: TaskAgentDefinition): boolean {
  return (
    a.agent === b.agent &&
    a.description === b.description &&
    a.instructions === b.instructions &&
    a.thinking === b.thinking &&
    a.tools.length === b.tools.length &&
    a.tools.every((tool, index) => b.tools[index] === tool)
  );
}

/** What a run lets a task agent have. */
export interface TaskAgentLimits {
  /** The run's child tools: the capability ceiling every child runs under. */
  childTools: readonly string[];
  /** The run's thinking level: the most a task agent may think. */
  thinking: ThinkingLevel;
}

/** The tools a task agent may name in a run: the nameable ones among its child tools. */
export function nameableTools(childTools: readonly string[]): SubagentTool[] {
  return SUBAGENT_TOOLS.filter((tool) => childTools.includes(tool));
}

/**
 * Why a definition's text would not register, or null when it would: pi-subagents refuses blank
 * text, surrounding whitespace and NUL characters, and the contract bounds the length. A request
 * arrives trimmed (`requestedDefinition`); a recorded definition is checked again on replay.
 */
function textProblem(field: string, text: string, maxLength: number): string | null {
  if (!text) return `its ${field} is blank`;
  if (text.trim() !== text) return `its ${field} starts or ends with whitespace`;
  if (text.length > maxLength) return `its ${field} is longer than ${maxLength} characters`;
  if (text.includes('\0')) return `its ${field} contains a NUL character`;
  return null;
}

/** Why a run cannot have `definition`, or null when it can. */
export function definitionProblem(
  definition: TaskAgentDefinition,
  limits: TaskAgentLimits,
): string | null {
  const text =
    textProblem('description', definition.description, TASK_AGENT_DESCRIPTION_MAX_LENGTH) ??
    textProblem('instructions', definition.instructions, TASK_AGENT_INSTRUCTIONS_MAX_LENGTH);
  if (text) return text;
  const allowed = nameableTools(limits.childTools);
  const missing = definition.tools.filter((tool) => !allowed.includes(tool));
  if (missing.length)
    return `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not among the tools children have in this run (${allowed.join(', ') || 'none'})`;
  if (thinksAbove(definition.thinking, limits.thinking)) {
    const levels = THINKING_LEVELS.filter((level) => !thinksAbove(level, limits.thinking));
    return `thinking ${definition.thinking} is above this run's ${limits.thinking} (use ${levels.join(', ')})`;
  }
  return null;
}

/** What a task agent's role follows: the rules of every child, then where the role comes from. */
const TASK_AGENT_PREAMBLE = `${SUBAGENT_CHILD_SYSTEM_PROMPT} The parent agent wrote the role below for this task; follow it within these rules.`;

/**
 * The runtime agent pi-subagents registers for an accepted definition: the service pins, its
 * tools and thinking, and a system prompt of the child preamble and its role. Nothing else of a
 * request reaches pi-subagents; a model is never set, so children keep the run's.
 */
export function taskRuntimeDefinition(definition: TaskAgentDefinition): RuntimeAgentDefinition {
  return pinnedRuntimeDefinition({
    description: definition.description,
    systemPrompt: `${TASK_AGENT_PREAMBLE}\n\n<role>\n${definition.instructions}\n</role>`,
    tools: [...definition.tools],
    thinking: definition.thinking,
  });
}
