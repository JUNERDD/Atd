import type { TaskRun } from '@atd/agent-contracts';
import { withheldSkills } from './computer/tool-set.js';
import { recordRunPrepDegradation } from './diagnostics/run-prep-ring.js';
import type { PluginSkillSet } from './plugins/skill-set.js';
import { ensureSkillProfile, skillProfilePaths } from './skills/profile.js';
import { freezeRunRole } from './skills/roles.js';
import { captureRunSkills, type RunSkills } from './skills/run-skills.js';
import { freezeSkillCatalog, type RunSkillCatalog } from './skills/skill-catalog.js';
import { takeTaskStaging } from './skills/staging.js';
import { freezeRunSkills, loadSkillCatalog } from './skills/versions.js';
import type { ServicePaths } from './storage.js';

export interface SkillFreezeDeps {
  ctx: { paths: Pick<ServicePaths, 'root' | 'agentDir'> };
  taskId: string;
  audit: (entry: Record<string, unknown>) => void;
}

/**
 * Freezes skills and the role, then captures the skills the run loads and the skill catalog its
 * model is told about, both from one read of the catalog. Answers those and the run's tool ceiling
 * for its children.
 */
export async function freezeSkillsForRun(
  deps: SkillFreezeDeps,
  run: TaskRun,
  plugins: PluginSkillSet,
  computer: boolean,
): Promise<{ toolCeiling: string[]; skills: RunSkills; catalog: RunSkillCatalog }> {
  // T3 additive freeze: staged next-run selection is consumed once; runs
  // without staging freeze empty skills + the default role (T1/T2 shape).
  const profile = skillProfilePaths(deps.ctx.paths.root, deps.ctx.paths.agentDir);
  await ensureSkillProfile(profile);
  const staging = await takeTaskStaging(profile, deps.taskId);
  const catalogRecords = await loadSkillCatalog(profile, plugins);
  const snapshot = await freezeRunSkills(profile, run.id, staging.skills, catalogRecords);
  const { role, capabilities } = await freezeRunRole(profile, {
    runId: run.id,
    ...(staging.roleId !== undefined && { roleId: staging.roleId }),
    requestedTools: [...run.snapshot.tools],
    requestedSkills: snapshot.skills.map((skill) => skill.name),
  });
  const skills = await captureRunSkills(snapshot, capabilities);
  if (skills.diagnostics.length > 0)
    recordRunPrepDegradation(run.id, 'freeze_skills', 'skills_blocked');
  const catalog = freezeSkillCatalog(
    catalogRecords,
    role,
    capabilities.revokedSkills,
    withheldSkills(computer),
  );
  deps.audit({
    taskId: deps.taskId,
    runId: run.id,
    skillRevision: snapshot.revision,
    skillCount: snapshot.skills.length,
    loadedSkills: skills.loaded.map(({ name, revision }) => ({ name, revision })),
    skillDiagnostics: skills.diagnostics,
    skillCatalog: {
      loadable: catalog.invocable.length,
      userOnly: catalog.userOnly.length,
      chars: catalog.text.length,
    },
  });
  return { toolCeiling: capabilities.tools, skills, catalog };
}
