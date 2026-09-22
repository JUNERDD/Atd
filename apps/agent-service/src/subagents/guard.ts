import type { SessionFactoryDeps } from '../pi-session.js';
import { serviceAgentNames } from './agents.js';
import {
  CLOSED_SUBAGENT_ACTIONS,
  FORBIDDEN_SUBAGENT_PARAMS,
  SERVICE_CHAIN_WORKFLOW,
  SERVICE_PARALLEL_WORKFLOW,
  SUBAGENT_LIMITS,
} from './config.js';
import {
  activeChildCount,
  isParentStopping,
  liveChildren,
  parentByTask,
  releaseWorkflow,
  tryAcquireWorkflow,
} from './registry.js';
import { validateChainArgs, validateParallelArgs } from './workflows.js';

/**
 * T5 foreground dispatch guard. Blocks disallowed subagent invocations with
 * explicit reasons before the delegator runs: closed actions/params, missing
 * async:false, non-fresh context, overrides, unknown workflows/agents, ledger
 * resource refs and the 3-child / 1-workflow ceilings. Never throws.
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
  const parent = parentByTask(deps.taskId);
  if (!parent) return { block: true, reason: 'Unknown parent session.' };
  const active = activeChildCount(parent.sessionId);
  const incoming = workflow === SERVICE_PARALLEL_WORKFLOW ? tasks.length : 1;
  if (active + incoming > SUBAGENT_LIMITS.maxForegroundChildren)
    return { block: true, reason: 'Foreground child limit (3) would be exceeded.' };
  const acquired = tryAcquireWorkflow(parent.sessionId);
  if (!acquired.ok) return { block: true, reason: acquired.reason ?? 'Workflow is busy.' };
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

function guardSingleCall(
  deps: SessionFactoryDeps,
  input: Record<string, unknown>,
): { block?: boolean; reason?: string } | undefined {
  const agent = input['agent'];
  const task = input['task'];
  if (typeof agent !== 'string' || !serviceAgentNames().includes(agent))
    return { block: true, reason: 'Subagent agent must be a service runtime agent.' };
  if (typeof task !== 'string' || !task.trim() || task.length > 8000)
    return { block: true, reason: 'Subagent task must hold 1-8000 characters.' };
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
  const parent = parentByTask(deps.taskId);
  if (!parent) return { block: true, reason: 'Unknown parent session.' };
  if (activeChildCount(parent.sessionId) >= SUBAGENT_LIMITS.maxForegroundChildren)
    return { block: true, reason: 'Foreground child limit (3) is reached.' };
  return undefined;
}

/** Releases the workflow slot and audits the landed result (never throws). */
export function onSubagentResult(
  deps: SessionFactoryDeps,
  event: { toolName: string; input: Record<string, unknown> },
): void {
  try {
    if (event.toolName !== 'subagent') return;
    const parent = parentByTask(deps.taskId);
    if (!parent) return;
    if (typeof event.input?.['workflow'] === 'string') releaseWorkflow(parent.sessionId);
    const children = liveChildren(parent.sessionId);
    deps.audit({ taskId: deps.taskId, subagentResult: true, liveChildren: children.length });
  } catch {
    // Result landing never throws into the Pi runner.
  }
}
