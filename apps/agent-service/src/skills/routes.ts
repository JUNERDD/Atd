import type { SkillListItem } from '@atd/agent-contracts';
import { ensureSkillProfile, type SkillProfilePaths } from './profile.js';
import { checkSkillExecution } from './capability-check.js';
import type { SkillDiagnostic } from './diagnostics.js';
import {
  freezeRoleSnapshot,
  freezeCapabilitySnapshot,
  listRoles,
  putRole,
  resolveRole,
  type CapabilitySnapshotRecord,
  type RoleRow,
  type RoleSnapshotRecord,
} from './roles.js';
import { peekTaskStaging, stageTaskSkills, takeTaskStaging, type TaskStaging } from './staging.js';
import { readDisabledSkillNames, setSkillHarnessEnabled } from './harness.js';
import { deleteAtdSkill, discoverAtdSkills, mergeSkillCatalog } from './atd-skills.js';
import { discoverUserAgentSkills } from './user-agents.js';
import { isBuiltinSkill, type BuiltinStatus } from '../builtins/manifest.js';
import { reconcileBuiltinSkills } from '../builtins/skills.js';
import { PluginHost } from '../plugins/host.js';
import { USER_PLUGIN } from '../plugins/host-plugins.js';
import { currentPluginSkillSet, skillPluginId, type PluginSkillSet } from '../plugins/skill-set.js';
import {
  freezeRunSkills,
  loadRunSnapshot,
  loadSkillCatalog,
  releaseRun,
  type SkillRefInput,
  type SkillRevisionRecord,
  type SkillSnapshotRecord,
} from './versions.js';

/**
 * T3 skill/role handlers. `skills/mount.ts` mounts them; this module never touches Fastify.
 * All inputs are already validated by the caller against the contracts in
 * `packages/agent-contracts/src/skills.ts` and `roles.ts`. Installing and updating skills goes
 * through plugins (`/v1/plugins`, plugins/routes.ts); the catalog here lists every source.
 */
export interface SkillRouteDeps {
  profile: SkillProfilePaths;
}

/**
 * A catalog row: the contract's `SkillListItem`, with the capability as the catalog records it
 * (tool names checked when a script skill runs, skills/capability-check.ts).
 */
export type SkillListRow = Omit<SkillListItem, 'capability'> & {
  capability: SkillRevisionRecord['capability'];
};

export async function listSkills(
  deps: SkillRouteDeps,
  runId?: string,
): Promise<{ skills: SkillListRow[]; diagnostics: SkillDiagnostic[] }> {
  await ensureSkillProfile(deps.profile);
  const disabled = await readDisabledSkillNames(deps.profile);
  if (runId) {
    // A frozen run's rows still report the live builtin status of their product skills.
    const [snapshot, builtins] = await Promise.all([
      loadRunSnapshot(deps.profile, runId),
      reconcileBuiltinSkills(),
    ]);
    return {
      skills: snapshot.skills.map((record) =>
        toRow(record, !disabled.has(record.name), builtins.statuses),
      ),
      diagnostics: snapshot.diagnostics,
    };
  }
  const plugins = await currentPluginSkillSet(deps.profile.root);
  const [atd, agents] = await Promise.all([discoverAtdSkills(), discoverUserAgentSkills()]);
  const skills = mergeSkillCatalog(plugins.records, atd.skills, agents.skills);
  return {
    skills: skills.map((record) =>
      toRow(record, rowEnabled(record, disabled, plugins), atd.builtins),
    ),
    diagnostics: [...atd.diagnostics, ...agents.diagnostics].slice(0, 64),
  };
}

/** A plugin skill is on when effective; a shared one also needs the shared plugin on. */
function rowEnabled(
  record: SkillRevisionRecord,
  disabled: ReadonlySet<string>,
  plugins: PluginSkillSet,
): boolean {
  if (record.sourceKind === 'plugin') return plugins.effective.has(record.name);
  if (record.sourceKind === 'agents' && !plugins.sharedEnabled) return false;
  return !disabled.has(record.name);
}

/**
 * Stores enablement for one catalog skill. A plugin skill's switch is its plugin item
 * (installer state); a host skill's is the harness. Skill files are not opened for write.
 */
export async function setSkillEnabled(
  deps: SkillRouteDeps,
  input: { name: string; enabled: boolean },
): Promise<{ name: string; enabled: boolean }> {
  await ensureSkillProfile(deps.profile);
  const current = await getSkill(deps, input.name);
  if (!current.skill) throw new Error(`Skill "${input.name}" is not in the harness catalog.`);
  const item = (await currentPluginSkillSet(deps.profile.root)).items.get(input.name);
  if (item) {
    const host = await PluginHost.for(deps.profile.root);
    await host.installer.setItemEnabled(item.pluginId, `skill:${item.localName}`, input.enabled);
  } else await setSkillHarnessEnabled(deps.profile, input.name, input.enabled);
  return { name: input.name, enabled: input.enabled };
}

/**
 * Deletes one Personal catalog skill (`~/.atd/skills`, not built in) and forgets its harness
 * switch, so a later skill of the same name starts enabled. Plugin and shared skills are refused:
 * a plugin is uninstalled as a whole, and `~/.agents/skills` belongs to other apps as well.
 * A session that already loaded the skill keeps its text; loading it afterwards fails.
 */
export async function deleteSkill(
  deps: SkillRouteDeps,
  name: string,
): Promise<{ name: string; deleted: true }> {
  await ensureSkillProfile(deps.profile);
  const { skill } = await getSkill(deps, name);
  if (!skill) throw new Error(`Skill "${name}" is not in the harness catalog.`);
  await deleteAtdSkill(skill);
  await setSkillHarnessEnabled(deps.profile, name, true);
  return { name, deleted: true };
}

/**
 * One catalog skill, in catalog merge order: the installed plugin skill that owns the name, then
 * `~/.atd`, then `~/.agents`.
 */
export async function getSkill(
  deps: SkillRouteDeps,
  name: string,
): Promise<{ skill: SkillRevisionRecord | null; diagnostics: SkillDiagnostic[] }> {
  const plugins = await currentPluginSkillSet(deps.profile.root);
  const plugin = plugins.records.find((item) => item.name === name);
  if (plugin) return { skill: plugin, diagnostics: [] };
  const atd = await discoverAtdSkills();
  const atdSkill = atd.skills.find((item) => item.name === name) ?? null;
  if (atdSkill) return { skill: atdSkill, diagnostics: [] };
  const agents = await discoverUserAgentSkills();
  const skill = agents.skills.find((item) => item.name === name) ?? null;
  return { skill, diagnostics: [] };
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
  const skills = await freezeRunSkills(
    deps.profile,
    input.runId,
    staging.skills,
    await loadSkillCatalog(deps.profile, await currentPluginSkillSet(deps.profile.root)),
  );
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

export async function listRolesHandler(deps: SkillRouteDeps): Promise<{ roles: RoleRow[] }> {
  await ensureSkillProfile(deps.profile);
  return { roles: await listRoles(deps.profile) };
}

export async function putRoleHandler(
  deps: SkillRouteDeps,
  input: { id: string; title: string; allows: { tools: string[]; skills: string[] } },
): Promise<{ role: RoleRow }> {
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

function toRow(
  record: SkillRevisionRecord,
  enabled: boolean,
  builtins: ReadonlyMap<string, BuiltinStatus>,
): SkillListRow {
  const atd = record.sourceKind === 'atd';
  const system = atd && isBuiltinSkill(record.name);
  const pluginId = skillPluginId(record, system);
  return {
    name: record.name,
    revision: record.revision,
    description: record.description,
    sourceKind: record.sourceKind,
    system,
    builtin: (atd && builtins.get(record.name)) || null,
    disableModelInvocation: record.disableModelInvocation,
    enabled,
    capability: record.capability,
    pluginId,
    readOnly: pluginId !== USER_PLUGIN,
  };
}
