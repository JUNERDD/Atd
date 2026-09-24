import {
  encodedArgsSize,
  parse,
  ChainWorkflowArgsSchema,
  ParallelWorkflowArgsSchema,
  type ChainWorkflowArgs,
  type ParallelWorkflowArgs,
  type WorkflowTask,
} from '@ai/agent-contracts';
import { SERVICE_CHAIN_WORKFLOW, SERVICE_PARALLEL_WORKFLOW, SUBAGENT_LIMITS } from './config.js';

/**
 * T5 named parallel/chain templates. Registration uses the trusted
 * `registerWorkflowResource` seam; scripts use `runs.all` plus sequential
 * `runs.run` with explicit `async:false` on every child. Raw scripts, script
 * paths, resume, external runners and capacity overrides stay forbidden.
 */

export interface WorkflowResolveOk {
  script: string;
}

export interface WorkflowResolveErr {
  error: string;
}

const SERVICE_AGENTS = new Set(['service.worker', 'service.reviewer', 'service.scout']);

function checkTask(task: WorkflowTask, index: number): string | null {
  if (!SERVICE_AGENTS.has(task.agent)) return `tasks[${index}].agent is not a service agent.`;
  if (!task.task.trim()) return `tasks[${index}].task is empty.`;
  for (const id of task.resources ?? []) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return `tasks[${index}].resources holds a bad id.`;
  }
  return null;
}

function withResources(task: WorkflowTask): string {
  const refs = (task.resources ?? []).map((id) => `resource:${id}`).join(' ');
  return refs ? `${task.task}\n\nResources: ${refs}` : task.task;
}

/** Validates parallel args: at least one task, 16 KiB cap, JSON data only. */
export function validateParallelArgs(value: unknown):
  | {
      ok: true;
      args: ParallelWorkflowArgs;
    }
  | {
      ok: false;
      error: string;
    } {
  let args: ParallelWorkflowArgs;
  try {
    args = parse(ParallelWorkflowArgsSchema, value);
  } catch {
    return { ok: false, error: 'Parallel args must match { tasks: [{ agent, task }] }.' };
  }
  if (encodedArgsSize(args) > SUBAGENT_LIMITS.namedArgsLimit)
    return { ok: false, error: 'Parallel args exceed 16 KiB; use resource refs.' };
  for (const [index, task] of args.tasks.entries()) {
    const problem = checkTask(task, index);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, args };
}

/** Validates chain args: 1-4 steps, 16 KiB cap, JSON data only. */
export function validateChainArgs(value: unknown):
  | {
      ok: true;
      args: ChainWorkflowArgs;
    }
  | {
      ok: false;
      error: string;
    } {
  let args: ChainWorkflowArgs;
  try {
    args = parse(ChainWorkflowArgsSchema, value);
  } catch {
    return { ok: false, error: 'Chain args must match { steps: [{ agent, task }] }.' };
  }
  if (encodedArgsSize(args) > SUBAGENT_LIMITS.namedArgsLimit)
    return { ok: false, error: 'Chain args exceed 16 KiB; use resource refs.' };
  for (const [index, task] of args.steps.entries()) {
    const problem = checkTask(task, index);
    if (problem) return { ok: false, error: problem };
  }
  return { ok: true, args };
}

/** Builds the parallel `runs.all` script with `async:false` everywhere. */
export function buildParallelScript(args: ParallelWorkflowArgs): string {
  const children = args.tasks
    .map(
      (task, index) =>
        `{ key: "p${index}", agent: ${JSON.stringify(task.agent)}, task: ${JSON.stringify(withResources(task))}, async: false${task.label ? `, label: ${JSON.stringify(task.label)}` : ''} }`,
    )
    .join(', ');
  return [
    `const results = await runs.all([${children}]);`,
    'return results.map((result) => ({ ok: result.ok, output: result.output, runId: result.runId ?? null }));',
  ].join('\n');
}

/** Builds the serial chain script with `async:false` on every step. */
export function buildChainScript(args: ChainWorkflowArgs): string {
  const lines: string[] = [];
  args.steps.forEach((step, index) => {
    const task = JSON.stringify(withResources(step));
    const agent = JSON.stringify(step.agent);
    const label = step.label ? `, label: ${JSON.stringify(step.label)}` : '';
    if (index === 0) {
      lines.push(
        `const s0 = await runs.run("c0", { agent: ${agent}, task: ${task}, async: false${label} });`,
      );
    } else {
      lines.push(
        `const s${index} = await runs.run("c${index}", { agent: ${agent}, task: ${task} + "\\n\\nPrevious output:\\n" + s${index - 1}.output, async: false${label} });`,
      );
    }
  });
  lines.push(`return s${args.steps.length - 1}.output;`);
  return lines.join('\n');
}

/** Resolve callback for `service.parallel`; sync, bounded, no I/O. */
export function resolveParallelResource(
  args: Readonly<Record<string, unknown>>,
): WorkflowResolveOk | WorkflowResolveErr {
  const validated = validateParallelArgs(args);
  if (!validated.ok) return { error: validated.error };
  return { script: buildParallelScript(validated.args) };
}

/** Resolve callback for `service.chain`; sync, bounded, no I/O. */
export function resolveChainResource(
  args: Readonly<Record<string, unknown>>,
): WorkflowResolveOk | WorkflowResolveErr {
  const validated = validateChainArgs(args);
  if (!validated.ok) return { error: validated.error };
  return { script: buildChainScript(validated.args) };
}

/** Registers both named templates for one parent session id. */
export async function registerServiceWorkflows(
  sessionId: string,
  register: (input: {
    sessionId: string;
    definition: {
      name: string;
      version: number;
      resolve: (args: Readonly<Record<string, unknown>>) => { script: string } | { error: string };
    };
  }) => { dispose(): void },
): Promise<{ dispose(): void }> {
  const parallel = register({
    sessionId,
    definition: { name: SERVICE_PARALLEL_WORKFLOW, version: 1, resolve: resolveParallelResource },
  });
  const chain = register({
    sessionId,
    definition: { name: SERVICE_CHAIN_WORKFLOW, version: 1, resolve: resolveChainResource },
  });
  return {
    dispose: () => {
      parallel.dispose();
      chain.dispose();
    },
  };
}
