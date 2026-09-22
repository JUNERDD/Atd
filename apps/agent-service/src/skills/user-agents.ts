import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent';
import { mapPiDiagnostics, type SkillDiagnostic } from './diagnostics.js';
import type { SkillRevisionRecord } from './versions.js';

/**
 * Live catalog of the real user `~/.agents/skills`. Uses `os.homedir()` so a
 * confined service HOME cannot hide or redirect this directory. Entries stay
 * on disk; install still copies only skills the person explicitly installs.
 * Pi's other default skill roots stay closed.
 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MAX_SKILLS = 500;
const MAX_DIAGNOSTICS = 64;

export function userAgentsSkillsDir(): string {
  return path.join(homedir(), '.agents', 'skills');
}

export async function discoverUserAgentSkills(): Promise<{
  skills: SkillRevisionRecord[];
  diagnostics: SkillDiagnostic[];
}> {
  const root = userAgentsSkillsDir();
  const loaded = loadSkillsFromDir({ dir: root, source: 'agents' });
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

/** User skills whose names are already installed stay out of the resolvable set. */
export function userSkillsNotInstalled(
  installedNames: ReadonlySet<string>,
  discovered: readonly SkillRevisionRecord[],
): SkillRevisionRecord[] {
  return discovered.filter((skill) => !installedNames.has(skill.name));
}

async function toRecord(
  skill: Skill,
  diagnostics: SkillDiagnostic[],
): Promise<SkillRevisionRecord | null> {
  if (!NAME_PATTERN.test(skill.name) || skill.name.length > 128) {
    pushDiagnostic(diagnostics, {
      type: 'warning',
      code: 'invalid_skill',
      message: `Skill "${skill.name}" in ~/.agents/skills does not match the service skill name rules.`,
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
    revision: `agents-${hash.slice(0, 32)}`,
    source: skill.filePath,
    sourceKind: 'agents',
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
