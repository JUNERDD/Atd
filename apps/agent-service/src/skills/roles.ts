import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { roleFingerprint } from '../builtins/fingerprint.js';
import { utcStamp } from '../builtins/install-dir.js';
import { DEFAULT_ROLE_BUILTIN, type BuiltinStatus } from '../builtins/manifest.js';
import {
  SHIPPED_ROLE_FINGERPRINT,
  defaultRoleStatus,
  placeDefaultRole,
  reconcileDefaultRole,
  shippedDefaultRole,
} from '../builtins/role.js';
import { readInstallState, recordInstall, withBuiltinLock } from '../builtins/state.js';
import { atomicWrite } from '../config.js';
import type { SkillProfilePaths } from './profile.js';

/** Managed role definition; structurally matches contracts RoleDefinition. */
export interface RoleRecord {
  id: string;
  revision: string;
  title: string;
  allows: { tools: string[]; skills: string[] };
  updatedAt: string;
}

export interface RoleSnapshotRecord {
  roleId: string;
  revision: string;
  allows: { tools: string[]; skills: string[] };
  frozenAt: string;
}

export interface CapabilitySnapshotRecord {
  runId: string;
  roleId: string;
  roleRevision: string;
  tools: string[];
  skills: string[];
  revokedTools: string[];
  revokedSkills: string[];
  frozenAt: string;
}

/** `<dataDir>/skills/roles.json`. */
export interface RolesFile {
  version: 1;
  roles: RoleRecord[];
  defaultRoleId: string;
}

/** A role as the roles routes answer it; `builtin` is set for the builtin default role only. */
export type RoleRow = RoleRecord & { builtin: BuiltinStatus | null };

/** Install record of the builtin default role, beside the roles file it describes. */
function roleStateFile(profile: SkillProfilePaths): string {
  return path.join(profile.profileDir, 'builtins.json');
}

async function readRolesFile(profile: SkillProfilePaths): Promise<RolesFile | null> {
  try {
    return JSON.parse(await readFile(profile.rolesFile, 'utf8')) as RolesFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('Skill roles could not be read. The original file is preserved.');
  }
}

/**
 * Reads the roles with the builtin default role reconciled (builtins/role.ts): installed when
 * absent, upgraded while untouched, kept once the user changed it. The caller holds the roles
 * lock. Answers the file and the default role's builtin status.
 */
async function reconciledRoles(
  profile: SkillProfilePaths,
): Promise<{ file: RolesFile; builtin: BuiltinStatus }> {
  const stateFile = roleStateFile(profile);
  let record = (await readInstallState(stateFile))[DEFAULT_ROLE_BUILTIN.id];
  const step = reconcileDefaultRole(await readRolesFile(profile), record);
  if (step.write) await atomicWrite(profile.rolesFile, step.file);
  if (step.record) record = await recordInstall(stateFile, DEFAULT_ROLE_BUILTIN, step.fingerprint);
  return { file: step.file, builtin: defaultRoleStatus(step.fingerprint, record) };
}

function readRoles(profile: SkillProfilePaths): Promise<RolesFile> {
  return withBuiltinLock(profile.rolesFile, async () => (await reconciledRoles(profile)).file);
}

function toRoleRow(role: RoleRecord, builtin: BuiltinStatus): RoleRow {
  return { ...role, builtin: role.id === DEFAULT_ROLE_BUILTIN.name ? builtin : null };
}

/** Lists managed roles; the service user profile owns them, no exec-dir overrides. */
export function listRoles(profile: SkillProfilePaths): Promise<RoleRow[]> {
  return withBuiltinLock(profile.rolesFile, async () => {
    const { file, builtin } = await reconciledRoles(profile);
    return file.roles.map((role) => toRoleRow(role, builtin));
  });
}

/** Upserts a managed role revision; runs freeze the revision they accepted. */
export function putRole(
  profile: SkillProfilePaths,
  input: { id: string; title: string; allows: { tools: string[]; skills: string[] } },
): Promise<RoleRow> {
  return withBuiltinLock(profile.rolesFile, async () => {
    const { file } = await reconciledRoles(profile);
    const role: RoleRecord = {
      id: input.id,
      revision: randomUUID(),
      title: input.title,
      allows: {
        tools: input.allows.tools.slice(0, 16),
        skills: input.allows.skills.slice(0, 128),
      },
      updatedAt: new Date().toISOString(),
    };
    const at = file.roles.findIndex((item) => item.id === role.id);
    if (at === -1) file.roles.push(role);
    else file.roles[at] = role;
    await atomicWrite(profile.rolesFile, file);
    const record = (await readInstallState(roleStateFile(profile)))[DEFAULT_ROLE_BUILTIN.id];
    return toRoleRow(role, defaultRoleStatus(roleFingerprint(role), record));
  });
}

/**
 * Restores the builtin default role to the shipped version. A stored default role that differs
 * from it is first written to `<dataDir>/skills/backups/role-default-<UTC stamp>.json`. Answers
 * that path, or null when there was nothing to keep.
 */
export function restoreDefaultRole(
  profile: SkillProfilePaths,
): Promise<{ backupPath: string | null; builtin: BuiltinStatus }> {
  return withBuiltinLock(profile.rolesFile, async () => {
    const stored = await readRolesFile(profile);
    const current = stored?.roles.find((role) => role.id === DEFAULT_ROLE_BUILTIN.name);
    const changed = current !== undefined && roleFingerprint(current) !== SHIPPED_ROLE_FINGERPRINT;
    let backupPath: string | null = null;
    if (changed) {
      backupPath = path.join(profile.profileDir, 'backups', `role-default-${utcStamp()}.json`);
      await mkdir(path.dirname(backupPath), { recursive: true });
      await writeFile(backupPath, `${JSON.stringify(current, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    if (!current || changed) {
      const base = stored ?? { version: 1, roles: [], defaultRoleId: DEFAULT_ROLE_BUILTIN.name };
      const role = shippedDefaultRole(new Date().toISOString());
      await atomicWrite(profile.rolesFile, placeDefaultRole(base, role));
    }
    const stateFile = roleStateFile(profile);
    const record = await recordInstall(stateFile, DEFAULT_ROLE_BUILTIN, SHIPPED_ROLE_FINGERPRINT);
    return { backupPath, builtin: defaultRoleStatus(SHIPPED_ROLE_FINGERPRINT, record) };
  });
}

/** Resolves the role for a new run; unknown ids fall back to the default role. */
export async function resolveRole(
  profile: SkillProfilePaths,
  roleId?: string,
): Promise<RoleRecord> {
  const file = await readRoles(profile);
  return (
    file.roles.find((role) => role.id === roleId) ??
    file.roles.find((role) => role.id === file.defaultRoleId) ??
    shippedDefaultRole()
  );
}

/** Freezes the role snapshot for a run; later role edits never mutate it. */
export function freezeRoleSnapshot(role: RoleRecord): RoleSnapshotRecord {
  return {
    roleId: role.id,
    revision: role.revision,
    allows: { tools: [...role.allows.tools], skills: [...role.allows.skills] },
    frozenAt: new Date().toISOString(),
  };
}

interface RoleRunsFile {
  version: 1;
  runs: Record<string, { role: RoleSnapshotRecord; capabilities: CapabilitySnapshotRecord }>;
}

function roleRunsFile(profile: SkillProfilePaths): string {
  return `${profile.profileDir}/role-runs.json`;
}

async function readRoleRuns(profile: SkillProfilePaths): Promise<RoleRunsFile> {
  try {
    return JSON.parse(await readFile(roleRunsFile(profile), 'utf8')) as RoleRunsFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, runs: {} };
    throw new Error('Role snapshots could not be read. The original file is preserved.');
  }
}

/**
 * Freezes role + capability snapshots for a run. Idempotent per runId:
 * repeats return the original pair, so role edits apply next run only.
 */
export async function freezeRunRole(
  profile: SkillProfilePaths,
  input: {
    runId: string;
    roleId?: string;
    requestedTools: string[];
    requestedSkills: string[];
  },
): Promise<{ role: RoleSnapshotRecord; capabilities: CapabilitySnapshotRecord }> {
  const file = await readRoleRuns(profile);
  const frozen = file.runs[input.runId];
  if (frozen) return frozen;
  const role = await resolveRole(profile, input.roleId);
  const snapshot = freezeRoleSnapshot(role);
  const capabilities = freezeCapabilitySnapshot({
    runId: input.runId,
    role: snapshot,
    requestedTools: input.requestedTools,
    requestedSkills: input.requestedSkills,
  });
  file.runs[input.runId] = { role: snapshot, capabilities };
  await atomicWrite(roleRunsFile(profile), file);
  return { role: snapshot, capabilities };
}

/** Loads frozen role + capabilities; unknown runs get the default role view. */
export async function loadRunRole(
  profile: SkillProfilePaths,
  runId: string,
): Promise<{ role: RoleSnapshotRecord; capabilities: CapabilitySnapshotRecord } | null> {
  return (await readRoleRuns(profile)).runs[runId] ?? null;
}

/**
 * Effective run capabilities: run request ∩ role allows ∩ service revocation.
 * Skill/MCP annotations and profile text are never consulted here and grant
 * nothing; only this snapshot authorizes tool and skill use.
 */
export function freezeCapabilitySnapshot(input: {
  runId: string;
  role: RoleSnapshotRecord;
  requestedTools: string[];
  requestedSkills: string[];
  revokedTools?: string[];
  revokedSkills?: string[];
}): CapabilitySnapshotRecord {
  const allowTools = new Set(input.role.allows.tools);
  const allowSkills = new Set(input.role.allows.skills);
  const revokedTools = new Set(input.revokedTools ?? []);
  const revokedSkills = new Set(input.revokedSkills ?? []);
  return {
    runId: input.runId,
    roleId: input.role.roleId,
    roleRevision: input.role.revision,
    tools: input.requestedTools.filter((tool) => allowTools.has(tool) && !revokedTools.has(tool)),
    skills: input.requestedSkills.filter(
      (skill) => (allowSkills.size === 0 || allowSkills.has(skill)) && !revokedSkills.has(skill),
    ),
    revokedTools: [...revokedTools],
    revokedSkills: [...revokedSkills],
    frozenAt: new Date().toISOString(),
  };
}
