import { SUBAGENT_WORKFLOWS } from '@ai/agent-contracts';
import type { SessionFactoryDeps } from '../pi-session.js';
import { SERVICE_PARALLEL_WORKFLOW } from './config.js';
import {
  beginDelegation,
  endDelegation,
  isParentStopping,
  liveChildren,
  parentByTask,
} from './registry.js';
import {
  isSubagentLaunch,
  SUBAGENT_ACTION_KEYS,
  SUBAGENT_TOOL,
  SUBAGENT_TOOL_KEYS,
} from './tool-contract.js';
import { validateChainArgs, validateParallelArgs } from './workflows.js';

/**
 * T5 foreground dispatch guard: the authority on which `subagent` calls dispatch. It admits exactly
 * the shapes the service tool contract advertises (tool-contract.ts) and refuses everything else
 * before the delegator runs, naming the shape to use instead so a model can correct its next call.
 * An admitted launching call becomes the parent's active delegation (registry.ts), which owns every
 * child launched until its result lands; one launching call runs at a time, as the tool contract
 * tells the model. Child and workflow concurrency within that call is not capped here. Never throws.
 */

export interface GuardInput {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
}

type GuardResult = { block?: boolean; reason?: string } | undefined;

const LAUNCH_SHAPES =
  'Use { agent, task } for one child, { workflow: "service.parallel", args: { tasks: [{ agent, task }] } } for children at the same time, or { workflow: "service.chain", args: { steps: [{ agent, task }] } } for children in order.';

const WORKFLOWS = new Set<string>(SUBAGENT_WORKFLOWS);

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
  if (input['capabilities'] !== undefined || input['id'] !== undefined)
    return refuse('capabilities and id belong to the list and status actions.');
  const parent = parentByTask(deps.taskId);
  if (!parent) return refuse('Unknown parent session.');
  // Pi prepares every call of one message before running them, so a second launch admitted here
  // would take over the first call's children; pi-subagents would reject its dispatch anyway.
  if (parent.activeToolCallId)
    return refuse('Another subagent call is still running; wait for its result.');
  if (input['workflow'] !== undefined) return guardWorkflowCall(deps, parent.agents, input);
  if (input['args'] !== undefined)
    return refuse(`Subagent args belong to a workflow call. ${LAUNCH_SHAPES}`);
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
    return refuse(`Subagent action ${String(action)} is not available; use list or status.`);
  // A habitual async:false is harmless on an action; any other extra key is a malformed call.
  const extra = Object.keys(input).find(
    (key) =>
      key !== 'action' && !allowed.includes(key) && !(key === 'async' && input['async'] === false),
  );
  if (extra)
    return refuse(
      `Subagent action ${String(action)} takes ${allowed.length ? allowed.join(', ') : 'no other params'}, not ${extra}.`,
    );
  return undefined;
}

function guardWorkflowCall(
  deps: SessionFactoryDeps,
  agents: string[],
  input: Record<string, unknown>,
): GuardResult {
  const workflow = input['workflow'];
  if (typeof workflow !== 'string' || !WORKFLOWS.has(workflow))
    return refuse(`Unknown workflow ${String(workflow)}. ${LAUNCH_SHAPES}`);
  if (input['agent'] !== undefined || input['task'] !== undefined)
    return refuse(`Workflow calls put each agent and task inside args. ${LAUNCH_SHAPES}`);
  const args = input['args'] ?? {};
  const validated =
    workflow === SERVICE_PARALLEL_WORKFLOW ? validateParallelArgs(args) : validateChainArgs(args);
  if (!validated.ok) return refuse(`${validated.error} ${LAUNCH_SHAPES}`);
  const tasks = 'tasks' in validated.args ? validated.args.tasks : validated.args.steps;
  const known = new Set(deps.ctx.ledger.data.resources.map((resource) => resource.id));
  for (const [index, task] of tasks.entries()) {
    const problem = delegationProblem(agents, task.agent, task.task);
    if (problem) return refuse(`Workflow task ${index}: ${problem}`);
    const missing = (task.resources ?? []).find((id) => !known.has(id));
    if (missing) return refuse(`Resource ${missing} is not in the ledger.`);
  }
  return undefined;
}

/**
 * Why one delegation is refused: the agent must be registered for this session (service agents plus
 * the atd agents the message referenced) and the task sized. Workflows apply it to every task.
 */
function delegationProblem(agents: string[], agent: unknown, task: unknown): string | null {
  if (typeof agent !== 'string' || !agents.includes(agent))
    return `Subagent agent must be one of: ${agents.join(', ')}.`;
  if (typeof task !== 'string' || !task.trim() || task.length > 8000)
    return 'Subagent task must hold 1-8000 characters.';
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
