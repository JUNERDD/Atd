import type { SessionFactoryDeps } from '../pi-session.js';
import {
  CLOSED_SUBAGENT_ACTIONS,
  FORBIDDEN_SUBAGENT_PARAMS,
  SERVICE_CHAIN_WORKFLOW,
  SERVICE_PARALLEL_WORKFLOW,
} from './config.js';
import { isParentStopping, liveChildren, parentByTask } from './registry.js';
import { validateChainArgs, validateParallelArgs } from './workflows.js';

/**
 * T5 foreground dispatch guard. Blocks disallowed subagent invocations with
 * explicit reasons before the delegator runs: closed actions/params, missing
 * async:false, non-fresh context, overrides, unknown workflows/agents, ledger
 * resource refs. Child and workflow concurrency is not capped here. Never throws.
 */

export interface GuardInput {
  toolName: string;
  input: Record<string, unknown>;
}

const ALLOWED_READ_ACTIONS = new Set(['status', 'list', 'get', 'guide', 'validate']);
const CLOSED_ACTIONS = new Set<string>(CLOSED_SUBAGENT_ACTIONS);
const FORBIDDEN_PARAMS = new Set<string>(FORBIDDEN_SUBAGENT_PARAMS);

/** Validates one `subagent` tool call; undefined allows it to dispatch. */
export function guardSubagentCall(
  deps: SessionFactoryDeps,
  event: GuardInput,
): { block?: boolean; reason?: string } | undefined {
  if (event.toolName !== 'subagent') return undefined;
  if (isParentStopping(deps.taskId)) return { block: true, reason: 'The parent is stopping.' };
  const input = event.input ?? {};
  if (input['capabilities'] === true) return undefined;
  const action = input['action'];
  if (typeof action === 'string') return guardAction(action);
  for (const param of FORBIDDEN_PARAMS) {
    if (input[param] !== undefined)
      return { block: true, reason: `Subagent param ${param} is forbidden.` };
  }
  if (input['workflowScript'] !== undefined || input['workflowScriptPath'] !== undefined)
    return { block: true, reason: 'Raw workflow scripts are forbidden; use named workflows.' };
  if (input['async'] !== false)
    return { block: true, reason: 'Subagent calls require explicit async:false.' };
  if (input['context'] !== undefined && input['context'] !== 'fresh')
    return { block: true, reason: 'Subagent context must be fresh.' };
  if (input['cwd'] !== undefined)
    return { block: true, reason: 'Subagent cwd overrides are forbidden.' };
  if (input['model'] !== undefined)
    return { block: true, reason: 'Subagent model overrides are forbidden.' };
  if (input['skill'] !== undefined)
    return { block: true, reason: 'Subagent skill overrides are forbidden.' };
  if (input['thinking'] !== undefined)
    return { block: true, reason: 'Subagent thinking overrides are forbidden.' };
  if (input['worktree'] === true)
    return { block: true, reason: 'Subagent worktrees are closed in round one.' };
  const workflow = input['workflow'];
  if (typeof workflow === 'string') return guardWorkflowCall(deps, input, workflow);
  if (input['tasks'] !== undefined) return guardParallelCall(deps, input);
  return guardSingleCall(deps, input);
}

function guardAction(action: string): { block?: boolean; reason?: string } | undefined {
  if (CLOSED_ACTIONS.has(action))
    return { block: true, reason: `Subagent action ${action} is closed in round one.` };
  if (ALLOWED_READ_ACTIONS.has(action) || action === 'interrupt') return undefined;
  return { block: true, reason: `Subagent action ${action} is not allowed.` };
}

function guardWorkflowCall(
  deps: SessionFactoryDeps,
  input: Record<string, unknown>,
  workflow: string,
): { block?: boolean; reason?: string } | undefined {
  if (workflow !== SERVICE_PARALLEL_WORKFLOW && workflow !== SERVICE_CHAIN_WORKFLOW)
    return { block: true, reason: `Unknown workflow ${workflow}.` };
  if (input['agent'] !== undefined || input['task'] !== undefined)
    return { block: true, reason: 'Workflow calls take workflow+args only.' };
  const args = (input['args'] ?? {}) as Record<string, unknown>;
  const tasks =
    workflow === SERVICE_PARALLEL_WORKFLOW
      ? validatedParallelTasks(args)
      : validatedChainTasks(args);
  if (typeof tasks === 'string') return { block: true, reason: tasks };
  const known = new Set(deps.ctx.ledger.data.resources.map((resource) => resource.id));
  for (const task of tasks) {
    for (const id of task.resources ?? []) {
      if (!known.has(id)) return { block: true, reason: `Resource ${id} is not in the ledger.` };
    }
  }
  if (!parentByTask(deps.taskId)) return { block: true, reason: 'Unknown parent session.' };
  return undefined;
}

function validatedParallelTasks(
  args: Record<string, unknown>,
): { agent: string; task: string; resources?: string[] }[] | string {
  const validated = validateParallelArgs(args);
  if (!validated.ok) return validated.error;
  return validated.args.tasks;
}

function validatedChainTasks(
  args: Record<string, unknown>,
): { agent: string; task: string; resources?: string[] }[] | string {
  const validated = validateChainArgs(args);
  if (!validated.ok) return validated.error;
  return validated.args.steps;
}

/** Keys a native parallel task may carry: the delegation itself, no per-task overrides. */
const PARALLEL_TASK_KEYS = new Set(['agent', 'task']);

/**
 * Native parallel fan-out: one call whose `tasks` run at the same time. It is the only way to run
 * subagents together, since pi-subagents rejects a second call while one is running. Each task
 * is checked like a single delegation.
 */
function guardParallelCall(
  deps: SessionFactoryDeps,
  input: Record<string, unknown>,
): { block?: boolean; reason?: string } | undefined {
  if (input['agent'] !== undefined || input['task'] !== undefined || input['chain'] !== undefined)
    return { block: true, reason: 'A parallel subagent call takes tasks only.' };
  const tasks = input['tasks'];
  if (!Array.isArray(tasks) || tasks.length === 0)
    return { block: true, reason: 'Subagent tasks must be a non-empty list of { agent, task }.' };
  const parent = parentByTask(deps.taskId);
  if (!parent) return { block: true, reason: 'Unknown parent session.' };
  for (const item of tasks) {
    if (typeof item !== 'object' || item === null || Array.isArray(item))
      return { block: true, reason: 'Each subagent task must be { agent, task }.' };
    const entry = item as Record<string, unknown>;
    const extra = Object.keys(entry).find((key) => !PARALLEL_TASK_KEYS.has(key));
    if (extra) return { block: true, reason: `Subagent task field ${extra} is not allowed.` };
    const problem = delegationProblem(parent.agents, entry['agent'], entry['task']);
    if (problem) return { block: true, reason: problem };
  }
  return undefined;
}

/** Why one delegation is refused: the agent must be registered for this session, the task sized. */
function delegationProblem(agents: string[], agent: unknown, task: unknown): string | null {
  // The session's registered agents: service agents plus referenced atd agents.
  if (typeof agent !== 'string' || !agents.includes(agent))
    return 'Subagent agent must be a service agent or an agent referenced in this message.';
  if (typeof task !== 'string' || !task.trim() || task.length > 8000)
    return 'Subagent task must hold 1-8000 characters.';
  return null;
}

function guardSingleCall(
  deps: SessionFactoryDeps,
  input: Record<string, unknown>,
): { block?: boolean; reason?: string } | undefined {
  const parent = parentByTask(deps.taskId);
  if (!parent) return { block: true, reason: 'Unknown parent session.' };
  const problem = delegationProblem(parent.agents, input['agent'], input['task']);
  if (problem) return { block: true, reason: problem };
  const resources = input['resources'];
  if (resources !== undefined) {
    if (!Array.isArray(resources))
      return { block: true, reason: 'Subagent resources are malformed.' };
    const known = new Set(deps.ctx.ledger.data.resources.map((resource) => resource.id));
    for (const id of resources) {
      if (typeof id !== 'string' || !known.has(id))
        return { block: true, reason: 'Subagent resource is not in the ledger.' };
    }
  }
  return undefined;
}

/** Audits the landed result (never throws). */
export function onSubagentResult(
  deps: SessionFactoryDeps,
  event: { toolName: string; input: Record<string, unknown> },
): void {
  try {
    if (event.toolName !== 'subagent') return;
    const parent = parentByTask(deps.taskId);
    if (!parent) return;
    const children = liveChildren(parent.sessionId);
    deps.audit({ taskId: deps.taskId, subagentResult: true, liveChildren: children.length });
  } catch {
    // Result landing never throws into the Pi runner.
  }
}
