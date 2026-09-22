import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

interface RolesFile {
  version: 1;
  roles: RoleRecord[];
  defaultRoleId: string;
}

const BUILTIN_DEFAULT: RoleRecord = {
  id: 'default',
  revision: 'rev-builtin-default',
  title: 'Default service role',
  allows: { tools: ['read', 'write', 'edit', 'bash', 'command'], skills: [] },
  updatedAt: new Date(0).toISOString(),
};

async function readRoles(profile: SkillProfilePaths): Promise<RolesFile> {
  try {
    return JSON.parse(await readFile(profile.rolesFile, 'utf8')) as RolesFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { version: 1, roles: [BUILTIN_DEFAULT], defaultRoleId: 'default' };
    throw new Error('Skill roles could not be read. The original file is preserved.');
  }
}

/** Lists managed roles; the service user profile owns them, no exec-dir overrides. */
export async function listRoles(profile: SkillProfilePaths): Promise<RoleRecord[]> {
  return (await readRoles(profile)).roles;
}

/** Upserts a managed role revision; runs freeze the revision they accepted. */
export async function putRole(
  profile: SkillProfilePaths,
  input: { id: string; title: string; allows: { tools: string[]; skills: string[] } },
): Promise<RoleRecord> {
  const file = await readRoles(profile);
  const record: RoleRecord = {
    id: input.id,
    revision: randomUUID(),
    title: input.title,
    allows: {
      tools: input.allows.tools.slice(0, 16),
      skills: input.allows.skills.slice(0, 128),
    },
    updatedAt: new Date().toISOString(),
  };
  const at = file.roles.findIndex((role) => role.id === record.id);
  if (at === -1) file.roles.push(record);
  else file.roles[at] = record;
  await atomicWrite(profile.rolesFile, file);
  return record;
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
    BUILTIN_DEFAULT
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
