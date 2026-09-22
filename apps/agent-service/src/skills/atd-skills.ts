import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent';
import { mapPiDiagnostics, type SkillDiagnostic } from './diagnostics.js';
import { ensureProductSkillsSeeded } from './seed-product-skills.js';
import type { SkillRevisionRecord } from './versions.js';

/**
 * Live catalog of product-home skills at `~/.atd/skills`. Uses `os.homedir()`
 * so a confined service HOME cannot hide or redirect this directory. Entries
 * stay on disk; they are never recorded as installed revisions.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_SKILLS = 500;
const MAX_DIAGNOSTICS = 64;

export function atdSkillsDir(): string {
  return path.join(homedir(), '.atd', 'skills');
}

export function atdAgentsDir(): string {
  return path.join(homedir(), '.atd', 'agents');
}

export async function discoverAtdSkills(): Promise<{
  skills: SkillRevisionRecord[];
  diagnostics: SkillDiagnostic[];
}> {
  await ensureProductSkillsSeeded();
  const root = atdSkillsDir();
  const loaded = loadSkillsFromDir({ dir: root, source: 'atd' });
  const diagnostics = mapPiDiagnostics(loaded.diagnostics)
    .filter((item) => item.code === 'same_name')
    .slice(0, MAX_DIAGNOSTICS);
  const records = await Promise.all(loaded.skills.map((skill) => toRecord(skill, diagnostics)));
  const skills = records
    .flatMap((record) => (record ? [record] : []))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SKILLS);
  return { skills, diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS) };
}

/** ATD skills whose names are already taken stay out of the resolvable set. */
export function atdSkillsNotInstalled(
  takenNames: ReadonlySet<string>,
  discovered: readonly SkillRevisionRecord[],
): SkillRevisionRecord[] {
  return discovered.filter((skill) => !takenNames.has(skill.name));
}

/**
 * Merge order: installed revisions, then ATD skills whose names are free,
 * then `~/.agents/skills` names that are still free.
 */
export function mergeSkillCatalog(
  installed: readonly SkillRevisionRecord[],
  atd: readonly SkillRevisionRecord[],
  agents: readonly SkillRevisionRecord[],
): SkillRevisionRecord[] {
  const names = new Set(installed.map((skill) => skill.name));
  const atdVisible = atdSkillsNotInstalled(names, atd);
  for (const skill of atdVisible) names.add(skill.name);
  const agentsVisible = agents.filter((skill) => !names.has(skill.name));
  return [...installed, ...atdVisible, ...agentsVisible]
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SKILLS);
}

async function toRecord(
  skill: Skill,
  diagnostics: SkillDiagnostic[],
): Promise<SkillRevisionRecord | null> {
  if (!NAME_PATTERN.test(skill.name) || skill.name.length > 128) {
    pushDiagnostic(diagnostics, {
      type: 'warning',
      code: 'invalid_skill',
      message: `Skill "${skill.name}" in ~/.atd/skills does not match the service skill name rules.`,
      skill: skill.name.slice(0, 128),
      path: skill.filePath.slice(0, 4096),
    });
    return null;
  }
  if (skill.filePath.length > 4096 || skill.baseDir.length > 4096) {
    pushDiagnostic(diagnostics, {
      type: 'warning',
      code: 'invalid_skill',
      message: `Skill "${skill.name}" path is too long to catalog.`,
      skill: skill.name,
      path: skill.filePath.slice(0, 4096),
    });
    return null;
  }
  let content: string;
  let installedAt: string;
  try {
    const [raw, file] = await Promise.all([readFile(skill.filePath, 'utf8'), stat(skill.filePath)]);
    content = raw;
    installedAt = file.mtime.toISOString();
  } catch (error) {
    pushDiagnostic(diagnostics, {
      type: 'warning',
      code: 'invalid_skill',
      message: error instanceof Error ? error.message : `Skill "${skill.name}" could not be read.`,
      skill: skill.name,
      path: skill.filePath,
    });
    return null;
  }
  const hash = createHash('sha256').update(content).digest('hex');
  return {
    name: skill.name,
    revision: `atd-${hash.slice(0, 32)}`,
    source: skill.filePath,
    sourceKind: 'atd',
    hash,
    license: '',
    entry: skill.filePath,
    baseDir: skill.baseDir,
    description: skill.description.trim().slice(0, 2048),
    disableModelInvocation: skill.disableModelInvocation,
    capability: classifySkill(content),
    installedAt,
  };
}

function classifySkill(content: string): { kind: 'text' | 'script'; tools: string[] } {
  const toolsMatch = /^tools:\s*\[(.+)\]/im.exec(content);
  if (!toolsMatch?.[1]) return { kind: 'text', tools: [] };
  const tools = toolsMatch[1]
    .split(',')
    .map((tool) => tool.trim().toLowerCase())
    .filter((tool) => ['read', 'write', 'edit', 'bash', 'command'].includes(tool));
  return { kind: tools.length ? 'script' : 'text', tools };
}

function pushDiagnostic(diagnostics: SkillDiagnostic[], diagnostic: SkillDiagnostic): void {
  if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push(diagnostic);
}
