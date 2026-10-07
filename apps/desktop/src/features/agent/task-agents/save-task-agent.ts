import {
  parse,
  SUBAGENT_TOOLS,
  SubagentPermissionsSchema,
  type SubagentPermissions,
  type SubagentTool,
  type TaskAgentDefinition,
} from '@atd/agent-contracts';
import type { ServiceBridge } from '../../../client/service/ipc';
import { ROLE_TOOLS, type ExtensionRoleTool } from '../../service/extension-rows';
import { readObject, readString } from '../../service/wire-read';

/**
 * Saving a task agent as one of the user's subagents (a Personal agent in `~/.atd/agents`) without
 * ever widening it. A Personal file lists only read, write, edit, bash and command, and a file that
 * lists none gets every tool the task allows; the Settings permission override names any subagent
 * tool and replaces the file's list from the next run. So the save writes the file with the
 * file-listable part of the task agent's tools, then sets the override to the exact set (which
 * also clears any override left under the name) and checks what the service kept. Until the
 * override lands the agent has a subset of the tools, never more; a task agent with no tools, or
 * with none a file can list, cannot be saved that way and is refused. The approval stays the
 * task's (null), as a task agent's does; the effort has no Personal field and is dropped.
 */

/** How a task agent saves, or why it cannot. */
export type TaskAgentSavePlan =
  | {
      kind: 'ready';
      /** The tools the agent file lists. */
      file: ExtensionRoleTool[];
      /** The exact tools the override keeps, in catalog order. */
      tools: SubagentTool[];
      /** The tools only the override carries. */
      overrideOnly: SubagentTool[];
    }
  | { kind: 'noTools' }
  | { kind: 'noFileTool'; tools: SubagentTool[] };

export type ReadySavePlan = Extract<TaskAgentSavePlan, { kind: 'ready' }>;

export function taskAgentSavePlan(definition: TaskAgentDefinition): TaskAgentSavePlan {
  const tools = SUBAGENT_TOOLS.filter((tool) => definition.tools.includes(tool));
  if (!tools.length) return { kind: 'noTools' };
  const file = ROLE_TOOLS.filter((tool) => tools.includes(tool));
  if (!file.length) return { kind: 'noFileTool', tools };
  const listed = new Set<string>(file);
  return { kind: 'ready', file, tools, overrideOnly: tools.filter((tool) => !listed.has(tool)) };
}

function fileStem(path: string): string {
  return (path.split('/').pop() ?? '').replace(/\.md$/i, '');
}

/**
 * The names a new Personal agent must not take, from the catalog route's answer: every catalog
 * agent, and the file name of every `~/.atd/agents` file that did not load, which a save under
 * that name would overwrite (the service writes `<name>.md`). Rows are read by field, so a row
 * outside the contract still holds its name.
 */
export function takenAgentNames(catalog: {
  agents: readonly unknown[];
  diagnostics: readonly unknown[];
}): string[] {
  const names = catalog.agents.map((row) => readString(row, 'name'));
  const files = catalog.diagnostics.map((diagnostic) => fileStem(readString(diagnostic, 'path')));
  return [...names, ...files].filter(Boolean);
}

/** Compared as the Settings form compares them: a case-insensitive disk keeps one of each. */
export function isTakenName(taken: readonly string[], name: string): boolean {
  const lower = name.trim().toLowerCase();
  return taken.some((value) => value.toLowerCase() === lower);
}

/** Whether the service kept exactly `tools` and the task's approval for the agent. */
function keepsExactly(result: unknown, tools: readonly SubagentTool[]): boolean {
  let permissions: SubagentPermissions;
  try {
    permissions = parse(SubagentPermissionsSchema, readObject(result, 'permissions'));
  } catch {
    return false;
  }
  const kept = permissions.tools;
  return (
    permissions.approval === null &&
    kept !== null &&
    kept.length === tools.length &&
    tools.every((tool) => kept.includes(tool))
  );
}

export type SaveTaskAgentResult =
  | { kind: 'saved' }
  /** Another agent took the name before the save ran; nothing was written. */
  | { kind: 'taken' }
  /** The exact tools could not be kept, so the agent written for them was removed again. */
  | { kind: 'notSaved' }
  /** As `notSaved`, but the removal failed too: the agent stays with its file tools only. */
  | { kind: 'narrowed' };

type AgentService = Pick<
  ServiceBridge,
  'agents' | 'putAgent' | 'setAgentPermissions' | 'deleteAgent'
>;

/**
 * Writes the task agent as the Personal agent `name` (see the module comment). Rejects when the
 * catalog read or the file write fails, which leaves nothing written that is wider than the task
 * agent; every later failure resolves to what is left.
 */
export async function saveTaskAgent(
  service: AgentService,
  name: string,
  definition: TaskAgentDefinition,
  plan: ReadySavePlan,
): Promise<SaveTaskAgentResult> {
  if (isTakenName(takenAgentNames(await service.agents()), name)) return { kind: 'taken' };
  await service.putAgent({
    name,
    description: definition.description.trim(),
    tools: plan.file,
    model: null,
    systemPrompt: definition.instructions.trim(),
  });
  try {
    const kept = await service.setAgentPermissions(name, { tools: plan.tools, approval: null });
    if (keepsExactly(kept, plan.tools)) return { kind: 'saved' };
  } catch {
    // The override did not land: removed below like an override the service changed.
  }
  try {
    await service.deleteAgent(name);
    return { kind: 'notSaved' };
  } catch {
    return { kind: 'narrowed' };
  }
}
