import { mcpStage, stageReferences, stageSkills, type AgentClientOptions } from '@ai/agent-client';
import type { RunPolicy } from './run-policy';
import { parseMcpTools } from './service-manage';

/**
 * Stages the per-run choices that the frozen submit request cannot carry: skills and role, then
 * MCP tools, then composer references. The service consumes each staging once, when it freezes
 * the task's next run.
 *
 * Each kind is staged only when the policy carries it, so a submit without references never calls
 * the reference route. A new task gets its id here the first time something is staged, and the
 * submit must reuse it; with nothing staged the service assigns the id.
 *
 * @returns the task id to submit with; null leaves it to the service.
 */
export async function stageRunChoices(
  options: AgentClientOptions | null,
  taskId: string | null,
  policy: RunPolicy | null,
): Promise<string | null> {
  if (!options || !policy) return taskId;
  let staged = taskId;
  const skills = policy.skills ?? [];
  if (skills.length || policy.roleId) {
    staged ??= crypto.randomUUID();
    await stageSkills(options, {
      taskId: staged,
      skills,
      ...(policy.roleId ? { roleId: policy.roleId } : {}),
    });
  }
  const tools = policy.mcpTools ? parseMcpTools(policy.mcpTools) : [];
  if (tools.length) {
    staged ??= crypto.randomUUID();
    await mcpStage({ options }, { taskId: staged, tools });
  }
  const references = policy.references ?? [];
  if (references.length) {
    staged ??= crypto.randomUUID();
    await stageReferences(options, { taskId: staged, references });
  }
  return staged;
}
