import { createManagedSettings, ensureSkillProfile, type SkillProfilePaths } from './profile.js';
import { ConfinedSkillPackages } from './package-manager.js';
import { checkSkillExecution } from './capability-check.js';
import type { SkillDiagnostic } from './diagnostics.js';
import {
  freezeRoleSnapshot,
  freezeCapabilitySnapshot,
  listRoles,
  putRole,
  resolveRole,
  type CapabilitySnapshotRecord,
  type RoleRecord,
  type RoleSnapshotRecord,
} from './roles.js';
import { peekTaskStaging, stageTaskSkills, takeTaskStaging, type TaskStaging } from './staging.js';
import { readDisabledSkillNames, setSkillHarnessEnabled } from './harness.js';
import { discoverAtdSkills, mergeSkillCatalog } from './atd-skills.js';
import { discoverUserAgentSkills } from './user-agents.js';
import {
  freezeRunSkills,
  listCurrent,
  listRevisions,
  loadRunSnapshot,
  releaseRun,
  type SkillRefInput,
  type SkillRevisionRecord,
  type SkillSnapshotRecord,
} from './versions.js';

/**
 * T3 skill/role handlers, UNMOUNTED. T34int mounts these on the exact paths
 * below; this module never touches Fastify so the proof calls handlers
 * directly. All inputs are already validated by the caller against the
 * contracts in `packages/agent-contracts/src/skills.ts` and `roles.ts`.
 *
 * Mount plan for T34int (all authenticated, loopback Bearer):
 * - GET    /v1/skills               -> listSkills
 * - GET    /v1/skills/:name         -> getSkill
 * - POST   /v1/skills/install       -> installSkill
 * - POST   /v1/skills/:name/update  -> updateSkill
 * - POST   /v1/skills/stage         -> stageSkills
 * - GET    /v1/roles                -> listRolesHandler
 * - PUT    /v1/roles/:id            -> putRoleHandler
 * - POST   /v1/runs/:runId/release  -> releaseRunHandler (skill side only)
 */
export interface SkillRouteDeps {
  profile: SkillProfilePaths;
}

export interface SkillListRow {
  name: string;
  revision: string;
  description: string;
  sourceKind: 'local' | 'npm' | 'git' | 'atd' | 'agents';
  disableModelInvocation: boolean;
  enabled: boolean;
  capability: { kind: 'text' | 'script'; tools: string[] };
}

export async function listSkills(
  deps: SkillRouteDeps,
  runId?: string,
): Promise<{ skills: SkillListRow[]; diagnostics: SkillDiagnostic[] }> {
  await ensureSkillProfile(deps.profile);
  const disabled = await readDisabledSkillNames(deps.profile);
  const listed = (record: SkillRevisionRecord) => toRow(record, !disabled.has(record.name));
  if (runId) {
    const snapshot = await loadRunSnapshot(deps.profile, runId);
    return {
      skills: snapshot.skills.map(listed),
      diagnostics: snapshot.diagnostics,
    };
  }
  const installed = await listCurrent(deps.profile);
  const [atd, agents] = await Promise.all([discoverAtdSkills(), discoverUserAgentSkills()]);
  const skills = mergeSkillCatalog(installed, atd.skills, agents.skills);
  return {
    skills: skills.map(listed),
    diagnostics: [...atd.diagnostics, ...agents.diagnostics].slice(0, 64),
  };
}

/** Stores harness enablement for one catalog skill. Skill files are not opened for write. */
export async function setSkillEnabled(
  deps: SkillRouteDeps,
  input: { name: string; enabled: boolean },
): Promise<{ name: string; enabled: boolean }> {
  await ensureSkillProfile(deps.profile);
  const current = await getSkill(deps, input.name);
  if (!current.skill) throw new Error(`Skill "${input.name}" is not in the harness catalog.`);
  await setSkillHarnessEnabled(deps.profile, input.name, input.enabled);
  return { name: input.name, enabled: input.enabled };
}

export async function getSkill(
  deps: SkillRouteDeps,
  name: string,
): Promise<{ skill: SkillRevisionRecord | null; diagnostics: SkillDiagnostic[] }> {
  const all = await listRevisions(deps.profile);
  const installed = [...all].reverse().find((item) => item.name === name) ?? null;
  if (installed) return { skill: installed, diagnostics: [] };
  const atd = await discoverAtdSkills();
  const atdSkill = atd.skills.find((item) => item.name === name) ?? null;
  if (atdSkill) return { skill: atdSkill, diagnostics: [] };
  const agents = await discoverUserAgentSkills();
  const skill = agents.skills.find((item) => item.name === name) ?? null;
  return { skill, diagnostics: [] };
}

export async function installSkill(
  deps: SkillRouteDeps,
  input: { source: string; sourceKind: 'local' | 'npm' | 'git'; name?: string },
): Promise<{ skill: SkillRevisionRecord; diagnostics: SkillDiagnostic[] }> {
  await ensureSkillProfile(deps.profile);
  const settings = createManagedSettings();
  const packages = new ConfinedSkillPackages(
    deps.profile,
    deps.profile.loaderCwd,
    deps.profile.agentDir,
    settings,
  );
  if (input.sourceKind === 'local') {
    const installed = await packages.installLocal(input.source, { name: input.name });
    return { skill: installed.record, diagnostics: installed.diagnostics };
  }
  const { entry, diagnostic } = await packages.resolveManagedNpm(input.name ?? input.source);
  if (!entry || diagnostic)
    throw new Error(diagnostic?.message ?? `Package "${input.source}" is not installed.`);
  const recorded = await packages.recordManaged(input.sourceKind, {
    name: input.name ?? input.source,
    source: input.source,
    entry,
  });
  return { skill: recorded.record, diagnostics: recorded.diagnostics };
}

/**
 * Update publishes a new immutable revision for local skills (re-reads the
 * source dir). npm/git updates resolve the managed entry; the new revision
 * takes effect on the next run, never on an active one.
 */
export async function updateSkill(
  deps: SkillRouteDeps,
  name: string,
): Promise<{ skill: SkillRevisionRecord; diagnostics: SkillDiagnostic[] }> {
  const current = await getSkill(deps, name);
  if (!current.skill) throw new Error(`Skill "${name}" is not installed.`);
  if (current.skill.sourceKind === 'atd') {
    return {
      skill: current.skill,
      diagnostics: [
        {
          type: 'warning',
          code: 'update_available',
          message: `Skill "${name}" is read from ~/.atd/skills and changes when that file changes.`,
          skill: name,
          path: current.skill.entry,
        },
      ],
    };
  }
  if (current.skill.sourceKind === 'agents') {
    return {
      skill: current.skill,
      diagnostics: [
        {
          type: 'warning',
          code: 'update_available',
          message: `Skill "${name}" is read from ~/.agents/skills and changes when that file changes.`,
          skill: name,
          path: current.skill.entry,
        },
      ],
    };
  }
  if (current.skill.sourceKind === 'local') {
    const settings = createManagedSettings();
    const packages = new ConfinedSkillPackages(
      deps.profile,
      deps.profile.loaderCwd,
      deps.profile.agentDir,
      settings,
    );
    const refreshed = await packages.installLocal(current.skill.source, { name });
    return { skill: refreshed.record, diagnostics: refreshed.diagnostics };
  }
  return {
    skill: current.skill,
    diagnostics: [
      {
        type: 'warning',
        code: 'update_available',
        message: `Skill "${name}" updates publish a new revision for the next run.`,
        skill: name,
      },
    ],
  };
}

export async function stageSkills(
  deps: SkillRouteDeps,
  input: { taskId: string; skills: SkillRefInput[]; roleId?: string },
): Promise<TaskStaging> {
  await ensureSkillProfile(deps.profile);
  return stageTaskSkills(deps.profile, input.taskId, input.skills, input.roleId);
}

export async function peekStaging(
  deps: SkillRouteDeps,
  taskId: string,
): Promise<TaskStaging | null> {
  return peekTaskStaging(deps.profile, taskId);
}

/** Freezes skill + role + capability snapshots for a run (called once at accept). */
export async function freezeRun(
  deps: SkillRouteDeps,
  input: { taskId: string; runId: string; requestedTools: string[]; roleId?: string },
): Promise<{
  skills: SkillSnapshotRecord;
  role: RoleSnapshotRecord;
  capabilities: CapabilitySnapshotRecord;
}> {
  await ensureSkillProfile(deps.profile);
  const staging = await takeTaskStaging(deps.profile, input.taskId);
  const skills = await freezeRunSkills(deps.profile, input.runId, staging.skills);
  const role = await resolveRole(deps.profile, input.roleId ?? staging.roleId);
  const roleSnapshot = freezeRoleSnapshot(role);
  const capabilities = freezeCapabilitySnapshot({
    runId: input.runId,
    role: roleSnapshot,
    requestedTools: input.requestedTools,
    requestedSkills: skills.skills.map((skill) => skill.name),
  });
  return { skills, role: roleSnapshot, capabilities };
}

export async function releaseRunHandler(
  deps: SkillRouteDeps,
  runId: string,
): Promise<{ released: boolean; pruned: number }> {
  return releaseRun(deps.profile, runId);
}

export async function listRolesHandler(deps: SkillRouteDeps): Promise<{ roles: RoleRecord[] }> {
  await ensureSkillProfile(deps.profile);
  return { roles: await listRoles(deps.profile) };
}

export async function putRoleHandler(
  deps: SkillRouteDeps,
  input: { id: string; title: string; allows: { tools: string[]; skills: string[] } },
): Promise<{ role: RoleRecord }> {
  await ensureSkillProfile(deps.profile);
  return { role: await putRole(deps.profile, input) };
}

/** Script-skill authorization preview: shows caps and checks the snapshot. */
export function previewSkillExecution(
  capabilities: CapabilitySnapshotRecord,
  skill: SkillRevisionRecord,
): ReturnType<typeof checkSkillExecution> {
  return checkSkillExecution(capabilities, skill.name, skill.capability.tools);
}

function toRow(record: SkillRevisionRecord, enabled: boolean): SkillListRow {
  return {
    name: record.name,
    revision: record.revision,
    description: record.description,
    sourceKind: record.sourceKind,
    disableModelInvocation: record.disableModelInvocation,
    enabled,
    capability: record.capability,
  };
}
