import { mcpStage, stageReferences, stageSkills, type AgentClientOptions } from '@atd/agent-client';
import type { RunPolicy } from './run-policy';
import { parseMcpTools } from './service-manage';

/** The per-run choices a composer submit stages. */
export type RunStaging = Pick<RunPolicy, 'skills' | 'roleId' | 'mcpTools' | 'references'>;

/**
 * Stages the per-run choices that the frozen submit request cannot carry: skills and role, then
 * MCP tools, then references. This is the one place a composer submit stages them; a saved
 * command's run stages its template's skills and references in the service instead
 * (`POST /v1/commands/:id/run`). The service consumes each staging once, when it freezes the
 * task's next run.
 *
 * Each kind is staged only when present, so a submit without references never calls the
 * reference route. A new task gets its id here the first time something is staged, and the
 * submit must reuse it; with nothing staged the service assigns the id.
 *
 * @returns the task id to submit with; null leaves it to the service.
 */
export async function stageRunChoices(
  options: AgentClientOptions | null,
  taskId: string | null,
  staging: RunStaging | null,
): Promise<string | null> {
  if (!options || !staging) return taskId;
  let staged = taskId;
  const skills = staging.skills ?? [];
  if (skills.length || staging.roleId) {
    staged ??= crypto.randomUUID();
    await stageSkills(options, {
      taskId: staged,
      skills,
      ...(staging.roleId ? { roleId: staging.roleId } : {}),
    });
  }
  const tools = staging.mcpTools ? parseMcpTools(staging.mcpTools) : [];
  if (tools.length) {
    staged ??= crypto.randomUUID();
    await mcpStage({ options }, { taskId: staged, tools });
  }
  const references = staging.references ?? [];
  if (references.length) {
    staged ??= crypto.randomUUID();
    await stageReferences(options, { taskId: staged, references });
  }
  return staged;
}
