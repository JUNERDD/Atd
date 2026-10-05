import type { ToolStatus } from '../../../client/agent/transcript-schema';

/**
 * Reading of a pi-subagents `subagent` call from its arguments. The one tool both launches
 * children (`agent` + `task`, `tasks`, `chain`, whose steps may run a `parallel` group, and, in
 * older transcripts, a named `workflow` or a raw workflow script), defines task agents
 * (`action: define`) and manages them (`action: list | guide | status | …`), so its row label,
 * target, and the group's launch count all come from the call shape rather than the tool name.
 */

export type SubagentStepKey =
  | 'activity.step.subagentRun'
  | 'activity.step.subagentList'
  | 'activity.step.subagentGuide'
  | 'activity.step.subagentStatus'
  | 'activity.step.subagentDefine'
  | 'activity.step.subagentManage'
  | 'activity.step.subagentWorkflow';

type Args = Record<string, unknown>;

function text(args: Args, key: string): string | null {
  const value = args[key];
  return typeof value === 'string' && value ? value : null;
}

/** A named workflow (older transcripts) carries its parallel `tasks` or `steps` inside `args`. */
function launchSource(args: Args): Args {
  const nested = args['args'];
  return text(args, 'workflow') && typeof nested === 'object' && nested !== null
    ? (nested as Args)
    : args;
}

/** A chain step that runs a `parallel` group stands for each of its children. */
function launchItems(item: unknown): unknown[] {
  const parallel =
    typeof item === 'object' && item !== null ? (item as Args)['parallel'] : undefined;
  return Array.isArray(parallel) ? parallel : [item];
}

/** Every child a multi-child call names, a chain's parallel groups flattened; null for one child. */
function launchList(args: Args): unknown[] | null {
  const source = launchSource(args);
  for (const key of ['tasks', 'steps', 'chain']) {
    const list = source[key];
    if (Array.isArray(list)) return list.flatMap(launchItems);
  }
  return null;
}

function isWorkflow(args: Args): boolean {
  return Boolean(
    text(args, 'workflow') || text(args, 'workflowScript') || text(args, 'workflowScriptPath'),
  );
}

/**
 * How many subagents the call dispatched: one per delegation (times its `count`), and one per task
 * of a parallel batch, per chain step (per child of a parallel step), or per named workflow task. Only a completed call counts:
 * a running one may still wait for approval or be refused, and a failed, declined, or interrupted
 * one dispatched nothing it could report. Management actions and raw scripts count none.
 */
export function subagentLaunches(args: Args, status: ToolStatus): number {
  if (status !== 'completed' || text(args, 'action')) return 0;
  const list = launchList(args);
  if (list) return list.length;
  if (!text(args, 'agent')) return 0;
  const count = args['count'];
  return typeof count === 'number' && Number.isInteger(count) && count > 0 ? count : 1;
}

export function subagentStepKey(args: Args): SubagentStepKey {
  const action = text(args, 'action');
  if (action === 'list') return 'activity.step.subagentList';
  if (action === 'guide') return 'activity.step.subagentGuide';
  if (action === 'status') return 'activity.step.subagentStatus';
  if (action === 'define') return 'activity.step.subagentDefine';
  if (action) return 'activity.step.subagentManage';
  if (isWorkflow(args)) return 'activity.step.subagentWorkflow';
  return 'activity.step.subagentRun';
}

/**
 * The names a define call gives (`agents[].name`, before the service adds `task.`), deduplicated
 * in call order; null when it names none.
 */
function definedNames(args: Args): string | null {
  const agents = args['agents'];
  const names = Array.isArray(agents)
    ? agents.flatMap((item: unknown) =>
        typeof item === 'object' && item !== null ? (text(item as Args, 'name') ?? []) : [],
      )
    : [];
  return names.length ? [...new Set(names)].join(', ') : null;
}

/**
 * What the row points at: the agents a launch addresses (deduplicated, in call order), the names
 * a define call gives, the guide topic, the inspected run, the workflow name, or the raw
 * management action.
 */
export function subagentTarget(args: Args): string | null {
  const action = text(args, 'action');
  if (action === 'guide') return text(args, 'topic');
  if (action === 'status') return text(args, 'id') ?? text(args, 'runId');
  if (action === 'list') return null;
  if (action === 'define') return definedNames(args);
  if (action) return action;
  const workflow = text(args, 'workflow');
  if (workflow) return workflow;
  if (isWorkflow(args)) return null;
  const agents = (launchList(args) ?? [args]).flatMap((item) =>
    typeof item === 'object' && item !== null ? (text(item as Args, 'agent') ?? []) : [],
  );
  return agents.length ? [...new Set(agents)].join(', ') : null;
}
