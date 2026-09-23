import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MAX_RUN_SKILLS } from '@ai/agent-contracts';
import { atomicWrite } from '../config.js';
import {
  diagnoseHarnessDisabled,
  diagnoseInvalidRef,
  diagnoseMissingPackage,
  diagnoseStaleRevision,
  type SkillDiagnostic,
} from './diagnostics.js';
import { readDisabledSkillNames } from './harness.js';
import type { SkillProfilePaths } from './profile.js';
import { discoverAtdSkills, mergeSkillCatalog } from './atd-skills.js';
import { discoverUserAgentSkills } from './user-agents.js';

/** Immutable installed revision; structurally matches contracts SkillRevision. */
export interface SkillRevisionRecord {
  name: string;
  revision: string;
  source: string;
  sourceKind: 'local' | 'npm' | 'git' | 'atd' | 'agents';
  hash: string;
  license: string;
  entry: string;
  baseDir: string;
  description: string;
  disableModelInvocation: boolean;
  capability: { kind: 'text' | 'script'; tools: string[] };
  installedAt: string;
}

export interface SkillRefInput {
  name: string;
  revision?: string;
}

export interface SkillSnapshotRecord {
  revision: string;
  frozenAt: string;
  requested: SkillRefInput[];
  skills: SkillRevisionRecord[];
  diagnostics: SkillDiagnostic[];
}

interface RevisionsFile {
  version: 1;
  revision: string;
  skills: SkillRevisionRecord[];
}

interface RunsFile {
  version: 1;
  runs: Record<
    string,
    { snapshot: SkillSnapshotRecord; released: boolean; releasedAt: string | null }
  >;
}

function emptyRevisions(): RevisionsFile {
  return { version: 1, revision: 'rev-empty', skills: [] };
}

function emptyRuns(): RunsFile {
  return { version: 1, runs: {} };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw new Error(`Skill store ${file} could not be read. The original file is preserved.`);
  }
}

/** Lists all live revisions (current plus old ones still held by frozen runs). */
export async function listRevisions(profile: SkillProfilePaths): Promise<SkillRevisionRecord[]> {
  return (await readJson<RevisionsFile>(profile.revisionsFile, emptyRevisions())).skills;
}

/** Latest revision per skill name; this is what new runs freeze. */
export async function listCurrent(profile: SkillProfilePaths): Promise<SkillRevisionRecord[]> {
  const all = await listRevisions(profile);
  const latest = new Map<string, SkillRevisionRecord>();
  for (const record of all) latest.set(record.name, record);
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Publishes an immutable revision. The same name+revision is idempotent; a
 * new revision for an existing name is appended and takes effect on the next
 * run. Active runs keep their frozen revision; nothing reloads them.
 */
export async function publishRevision(
  profile: SkillProfilePaths,
  record: SkillRevisionRecord,
): Promise<{ record: SkillRevisionRecord; updated: boolean }> {
  const file = await readJson<RevisionsFile>(profile.revisionsFile, emptyRevisions());
  const existing = file.skills.find(
    (item) => item.name === record.name && item.revision === record.revision,
  );
  if (existing) return { record: existing, updated: false };
  file.skills.push(record);
  file.revision = randomUUID();
  await atomicWrite(profile.revisionsFile, file);
  return { record, updated: true };
}

/** Resolves one ref against live revisions; missing content is a diagnostic. */
export function resolveRef(
  all: SkillRevisionRecord[],
  ref: SkillRefInput,
): { record: SkillRevisionRecord | null; diagnostic: SkillDiagnostic | null } {
  const invalid = diagnoseInvalidRef(ref.name);
  if (invalid) return { record: null, diagnostic: invalid };
  const candidates = all.filter((item) => item.name === ref.name);
  if (!candidates.length)
    return {
      record: null,
      diagnostic: diagnoseMissingPackage(ref.name, ref.name),
    };
  if (!ref.revision) {
    const latest = candidates[candidates.length - 1];
    if (!latest) throw new Error('Skill resolution reached an impossible state.');
    return { record: latest, diagnostic: null };
  }
  const pinned = candidates.find((item) => item.revision === ref.revision);
  if (!pinned)
    return {
      record: null,
      diagnostic: diagnoseStaleRevision(ref.name, ref.revision ?? ''),
    };
  const latest = candidates[candidates.length - 1];
  const diagnostic =
    latest && latest.revision !== pinned.revision
      ? diagnoseStaleRevision(ref.name, pinned.revision)
      : null;
  return { record: pinned, diagnostic };
}

/**
 * The skills one run requests: a name counts once, at its first occurrence
 * (a composer may carry the same skill chip twice), and the list stops at
 * `MAX_RUN_SKILLS`. Deduping first keeps a repeat from pushing a later
 * distinct skill past the cap.
 */
export function runSkillRefs(refs: readonly SkillRefInput[]): SkillRefInput[] {
  const first = new Map<string, SkillRefInput>();
  for (const ref of refs) if (!first.has(ref.name)) first.set(ref.name, ref);
  return [...first.values()].slice(0, MAX_RUN_SKILLS);
}

/**
 * Freezes the skill snapshot for a run. Idempotent per runId: repeats return
 * the original snapshot and never re-resolve, so updates apply next run and
 * active sessions are never reloaded.
 */
export async function freezeRunSkills(
  profile: SkillProfilePaths,
  runId: string,
  refs: SkillRefInput[],
): Promise<SkillSnapshotRecord> {
  const runs = await readJson<RunsFile>(profile.runsFile, emptyRuns());
  const frozen = runs.runs[runId];
  if (frozen) return frozen.snapshot;
  const installed = await listRevisions(profile);
  const [atd, agents] = await Promise.all([discoverAtdSkills(), discoverUserAgentSkills()]);
  const disabled = await readDisabledSkillNames(profile);
  const all = mergeSkillCatalog(installed, atd.skills, agents.skills);
  const requested = runSkillRefs(refs);
  const skills: SkillRevisionRecord[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const ref of requested) {
    const { record, diagnostic } = resolveRef(all, ref);
    if (record && disabled.has(record.name)) diagnostics.push(diagnoseHarnessDisabled(record.name));
    else if (record) skills.push(record);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  const snapshot: SkillSnapshotRecord = {
    revision: randomUUID(),
    frozenAt: new Date().toISOString(),
    requested,
    skills,
    diagnostics,
  };
  runs.runs[runId] = { snapshot, released: false, releasedAt: null };
  await atomicWrite(profile.runsFile, runs);
  return snapshot;
}

/** Loads the frozen snapshot; unknown runs get an empty (T1/T2) snapshot. */
export async function loadRunSnapshot(
  profile: SkillProfilePaths,
  runId: string,
): Promise<SkillSnapshotRecord> {
  const runs = await readJson<RunsFile>(profile.runsFile, emptyRuns());
  return (
    runs.runs[runId]?.snapshot ?? {
      revision: 'rev-empty',
      frozenAt: new Date(0).toISOString(),
      requested: [],
      skills: [],
      diagnostics: [],
    }
  );
}

/**
 * Releases a run and recycles old revisions no unreleased run references.
 * The latest revision per name is always kept; pinned old revisions survive
 * while any unreleased run holds them.
 */
export async function releaseRun(
  profile: SkillProfilePaths,
  runId: string,
): Promise<{ released: boolean; pruned: number }> {
  const runs = await readJson<RunsFile>(profile.runsFile, emptyRuns());
  const entry = runs.runs[runId];
  if (!entry) return { released: false, pruned: 0 };
  entry.released = true;
  entry.releasedAt = new Date().toISOString();
  await atomicWrite(profile.runsFile, runs);
  const held = new Set<string>();
  for (const run of Object.values(runs.runs)) {
    if (run.released) continue;
    for (const skill of run.snapshot.skills) held.add(`${skill.name}@${skill.revision}`);
  }
  const file = await readJson<RevisionsFile>(profile.revisionsFile, emptyRevisions());
  const latest = new Map<string, string>();
  for (const record of file.skills) latest.set(record.name, record.revision);
  const before = file.skills.length;
  file.skills = file.skills.filter(
    (record) =>
      latest.get(record.name) === record.revision || held.has(`${record.name}@${record.revision}`),
  );
  const pruned = before - file.skills.length;
  if (pruned) await atomicWrite(profile.revisionsFile, file);
  return { released: true, pruned };
}
