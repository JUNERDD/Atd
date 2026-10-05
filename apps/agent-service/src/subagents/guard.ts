import type { SessionFactoryDeps } from '../pi-session.js';
import {
  beginDelegation,
  endDelegation,
  isParentStopping,
  liveChildren,
  parentByTask,
  type ParentRecord,
} from './registry.js';
import { DEFINE_AGENTS_SHAPE } from './task-agent-definition.js';
import {
  isSubagentLaunch,
  SUBAGENT_ACTION_KEYS,
  SUBAGENT_CHILDREN_PER_CALL,
  SUBAGENT_TASK_MAX_LENGTH,
  SUBAGENT_TOOL,
  SUBAGENT_TOOL_KEYS,
} from './tool-contract.js';

/**
 * T5 foreground dispatch guard: the authority on which `subagent` calls dispatch. It admits exactly
 * the shapes the service tool contract advertises (tool-contract.ts) and refuses everything else
 * before the delegator runs, naming the shape to use instead so a model can correct its next call.
 * An admitted launching call becomes the parent's active delegation (registry.ts), which owns every
 * child launched until its result lands; one launching call runs at a time, as the tool contract
 * tells the model, and launches at most `SUBAGENT_CHILDREN_PER_CALL` children, which pi-subagents
 * runs a few at a time (config.ts). Which agents a launch may name is the parent's task-agents.ts
 * answer; a define call's agents are checked when it runs. Never throws.
 */

export interface GuardInput {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

type GuardResult = { block?: boolean; reason?: string } | undefined;

type Agents = ParentRecord['agents'];

const LAUNCH_SHAPES =
  'Use { agent, task } for one child, { tasks: [{ agent, task }] } for children at the same time, or { chain: [{ agent, task }, { parallel: [{ agent, task }] }] } for children in order.';

function refuse(reason: string): GuardResult {
  return { block: true, reason };
}

/** Validates one `subagent` tool call; undefined allows it to dispatch. */
export function guardSubagentCall(deps: SessionFactoryDeps, event: GuardInput): GuardResult {
  if (event.toolName !== SUBAGENT_TOOL) return undefined;
  const input = event.input ?? {};
  const refused = checkSubagentCall(deps, input);
  if (!refused && isSubagentLaunch(input)) beginDelegation(deps.taskId, event.toolCallId);
  return refused;
}

function checkSubagentCall(deps: SessionFactoryDeps, input: Record<string, unknown>): GuardResult {
  if (isParentStopping(deps.taskId)) return refuse('The parent is stopping.');
  const unknown = Object.keys(input).find((key) => !SUBAGENT_TOOL_KEYS.has(key));
  if (unknown) return refuse(`Subagent param ${unknown} is not supported here. ${LAUNCH_SHAPES}`);
  if (input['action'] !== undefined) return guardAction(input);
  // The tool contract pins omitted async to false, so anything else here would detach the launch.
  if (input['async'] !== false)
    return refuse('Subagent calls run in the foreground; omit async or pass async:false.');
  if (
    input['capabilities'] !== undefined ||
    input['id'] !== undefined ||
    input['agents'] !== undefined
  )
    return refuse('capabilities, id and agents belong to the list, status and define actions.');
  const parent = parentByTask(deps.taskId);
  if (!parent) return refuse('Unknown parent session.');
  // Pi prepares every call of one message before running them, so a second launch admitted here
  // would take over the first call's children; pi-subagents would reject its dispatch anyway.
  if (parent.activeToolCallId)
    return refuse('Another subagent call is still running; wait for its result.');
  if (input['tasks'] !== undefined || input['chain'] !== undefined)
    return guardBatch(parent.agents, input);
  const problem = delegationProblem(parent.agents, input['agent'], input['task']);
  return problem ? refuse(problem) : undefined;
}

function guardAction(input: Record<string, unknown>): GuardResult {
  const action = input['action'];
  const allowed =
    typeof action === 'string' && Object.hasOwn(SUBAGENT_ACTION_KEYS, action)
      ? SUBAGENT_ACTION_KEYS[action as keyof typeof SUBAGENT_ACTION_KEYS]
      : null;
  if (!allowed)
    return refuse(
      `Subagent action ${String(action)} is not available; use define, list or status.`,
    );
  // A habitual async:false is harmless on an action; any other extra key is a malformed call.
  const extra = Object.keys(input).find(
    (key) =>
      key !== 'action' && !allowed.includes(key) && !(key === 'async' && input['async'] === false),
  );
  if (extra)
    return refuse(
      `Subagent action ${String(action)} takes ${allowed.length ? allowed.join(', ') : 'no other params'}, not ${extra}.`,
    );
  if (action === 'define' && input['agents'] === undefined)
    return refuse(`Subagent action define takes agents: ${DEFINE_AGENTS_SHAPE}.`);
  return undefined;
}

/**
 * A `tasks` or `chain` call: each child names an agent and a task inside the list, so the call
 * itself carries neither, and every child passes the same check as a single delegation, those of
 * a chain's parallel steps included. All of them count toward the call's child limit.
 */
function guardBatch(agents: Agents, input: Record<string, unknown>): GuardResult {
  if (input['tasks'] !== undefined && input['chain'] !== undefined)
    return refuse(`Pass either tasks or chain, not both. ${LAUNCH_SHAPES}`);
  if (input['agent'] !== undefined || input['task'] !== undefined)
    return refuse(`tasks and chain carry each agent and task inside the list. ${LAUNCH_SHAPES}`);
  const field = input['tasks'] !== undefined ? 'tasks' : 'chain';
  const list = input[field];
  if (!Array.isArray(list) || !list.length)
    return refuse(`${field} must list at least one child. ${LAUNCH_SHAPES}`);
  const children = list.reduce<number>((count, item) => count + childCount(item), 0);
  if (children > SUBAGENT_CHILDREN_PER_CALL)
    return refuse(
      `A subagent call runs at most ${SUBAGENT_CHILDREN_PER_CALL} children; this one has ${children}. Split the work across calls.`,
    );
  for (const [index, item] of list.entries()) {
    const problem = field === 'tasks' ? childProblem(agents, item) : stepProblem(agents, item);
    if (problem) return refuse(`${field}[${index}]: ${problem}`);
  }
  return undefined;
}

/** The children one `tasks` item or chain step launches: a parallel step launches each of its own. */
function childCount(item: unknown): number {
  const parallel = isRecord(item) ? item['parallel'] : undefined;
  return Array.isArray(parallel) ? parallel.length : 1;
}

/** One chain step: a single child, or a `parallel` group of children and nothing else. */
function stepProblem(agents: Agents, step: unknown): string | null {
  if (!isRecord(step)) return 'A chain step must be { agent, task } or { parallel: [...] }.';
  const parallel = step['parallel'];
  if (parallel === undefined) return childProblem(agents, step);
  if (step['agent'] !== undefined || step['task'] !== undefined)
    return 'A parallel step carries only parallel: [{ agent, task }, ...].';
  if (!Array.isArray(parallel) || !parallel.length) return 'parallel must list at least one child.';
  for (const [index, item] of parallel.entries()) {
    const problem = childProblem(agents, item);
    if (problem) return `parallel[${index}]: ${problem}`;
  }
  return null;
}

function childProblem(agents: Agents, child: unknown): string | null {
  if (!isRecord(child)) return 'Each child must be { agent, task }.';
  return delegationProblem(agents, child['agent'], child['task']);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why one delegation is refused: the parent must be able to launch the agent in its current run
 * (task-agents.ts) and the task must be sized. `tasks` and `chain` apply it to every child.
 */
function delegationProblem(agents: Agents, agent: unknown, task: unknown): string | null {
  const refused = agents.refusal(agent);
  if (refused) return refused;
  if (typeof task !== 'string' || !task.trim() || task.length > SUBAGENT_TASK_MAX_LENGTH)
    return `Subagent task must hold 1-${SUBAGENT_TASK_MAX_LENGTH} characters.`;
  return null;
}

/** Ends the call's delegation and audits the landed result (never throws). */
export function onSubagentResult(
  deps: SessionFactoryDeps,
  event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
): void {
  try {
    if (event.toolName !== SUBAGENT_TOOL) return;
    endDelegation(deps.taskId, event.toolCallId);
    const parent = parentByTask(deps.taskId);
    if (!parent) return;
    const children = liveChildren(parent.sessionId);
    deps.audit({ taskId: deps.taskId, subagentResult: true, liveChildren: children.length });
  } catch {
    // Result landing never throws into the Pi runner.
  }
}

/**
 * Ends the call's delegation when its execution ends. A call another extension blocked after this
 * guard admitted it never reaches `tool_result`, and would otherwise hold the delegation open.
 */
export function onSubagentExecutionEnd(
  deps: SessionFactoryDeps,
  event: { toolName: string; toolCallId: string },
): void {
  if (event.toolName === SUBAGENT_TOOL) endDelegation(deps.taskId, event.toolCallId);
}
