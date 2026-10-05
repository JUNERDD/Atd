import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadSkillsFromDir, type Skill } from '@earendil-works/pi-coding-agent';
import { isBuiltinSkill, type BuiltinStatus } from '../builtins/manifest.js';
import { reconcileBuiltinSkills } from '../builtins/skills.js';
import { writeTextAtomic } from '../config.js';
import { ConflictError } from '../errors.js';
import { scanContent } from '../memory/scanner.js';
import { atdSkillsDir } from '../service-fs.js';
import { isItemName } from '@atd/plugin-kit';
import { mapPiDiagnostics, type SkillDiagnostic } from './diagnostics.js';
import type { SkillRevisionRecord } from './versions.js';

/**
 * Live catalog of product-home skills at `<atdHome>/skills` (service-fs.ts `atdHome`: `~/.atd`
 * through `os.homedir()` unless `AI_ATD_HOME` overrides it), so a confined service HOME cannot
 * hide or redirect this directory. Entries stay on disk; they are never recorded as installed
 * revisions.
 */
const MAX_SKILLS = 500;
const MAX_DIAGNOSTICS = 64;
/** The longest description Pi's skill loader accepts (the Agent Skills spec). */
const MAX_SKILL_DESCRIPTION = 1024;

/**
 * Reconciles the product skills (builtins/skills.ts), then loads the catalog. `builtins` holds
 * the builtin status of each product skill by name; reconcile failures join the diagnostics.
 */
export async function discoverAtdSkills(): Promise<{
  skills: SkillRevisionRecord[];
  diagnostics: SkillDiagnostic[];
  builtins: ReadonlyMap<string, BuiltinStatus>;
}> {
  const builtins = await reconcileBuiltinSkills();
  const root = atdSkillsDir();
  const loaded = loadSkillsFromDir({ dir: root, source: 'atd' });
  const diagnostics = [
    ...builtins.diagnostics,
    ...mapPiDiagnostics(loaded.diagnostics).filter((item) => item.code === 'same_name'),
  ].slice(0, MAX_DIAGNOSTICS);
  const records = await Promise.all(loaded.skills.map((skill) => toRecord(skill, diagnostics)));
  const skills = records
    .flatMap((record) => (record ? [record] : []))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SKILLS);
  return {
    skills,
    diagnostics: diagnostics.slice(0, MAX_DIAGNOSTICS),
    builtins: builtins.statuses,
  };
}

/**
 * Deletes one Personal skill from `<atdHome>/skills`: a `SKILL.md` skill takes its whole folder,
 * a loose `.md` file at the catalog root only that file. Built-in skills belong to System and are
 * refused, since the next reconcile would reinstall them anyway.
 */
export async function deleteAtdSkill(skill: SkillRevisionRecord): Promise<void> {
  if (skill.sourceKind !== 'atd' || isBuiltinSkill(skill.name))
    throw new ConflictError(`Skill "${skill.name}" is not a Personal skill and cannot be deleted.`);
  const root = path.resolve(atdSkillsDir());
  const folder = path.basename(skill.entry) === 'SKILL.md';
  const target = path.resolve(folder ? skill.baseDir : skill.entry);
  // The catalog root itself is never a target: a root-level file deletes only itself.
  if (!target.startsWith(`${root}${path.sep}`))
    throw new ConflictError(
      `Skill "${skill.name}" is outside ~/.atd/skills and cannot be deleted.`,
    );
  await rm(target, { recursive: folder, force: true });
}

/**
 * Creates one Personal skill, `<atdHome>/skills/<name>/SKILL.md`: frontmatter with the name and
 * the one-line description, then `body`. A product skill's name belongs to System and an existing
 * skill keeps its own, so both are refused (409), as are a malformed name or description and text
 * the memory content scan blocks (400). The folder is created exclusively before the file is
 * written atomically, so two creates of one name cannot mix; a failed write removes the folder.
 */
export async function createAtdSkill(input: {
  name: string;
  description: string;
  body: string;
}): Promise<{ name: string }> {
  const name = input.name.trim();
  if (!isItemName(name))
    throw new TypeError(
      `Skill name "${name}" must be 1–128 letters, digits, "-" or "_", starting with a letter or digit.`,
    );
  if (isBuiltinSkill(name))
    throw new ConflictError(`"${name}" is the name of a built-in skill. Choose another name.`);
  const description = input.description.replace(/\s+/g, ' ').trim();
  const body = input.body.replace(/\r\n?/g, '\n').trim();
  if (!description || description.length > MAX_SKILL_DESCRIPTION)
    throw new TypeError(`A skill description must be 1–${MAX_SKILL_DESCRIPTION} characters.`);
  if (!body) throw new TypeError('A skill needs instructions.');
  const blocked = scanContent(`${description}\n${body}`);
  if (blocked) throw new TypeError(blocked);
  const root = atdSkillsDir();
  const exists = () => new ConflictError(`A skill named "${name}" already exists.`);
  if (loadSkillsFromDir({ dir: root, source: 'atd' }).skills.some((skill) => skill.name === name))
    throw exists();
  const dir = path.join(root, name);
  await mkdir(root, { recursive: true });
  try {
    await mkdir(dir);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw exists();
    throw error;
  }
  const front = [`name: ${JSON.stringify(name)}`, `description: ${JSON.stringify(description)}`];
  try {
    await writeTextAtomic(
      path.join(dir, 'SKILL.md'),
      ['---', ...front, '---', '', body, ''].join('\n'),
      0o644,
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return { name };
}

/** ATD skills whose names are already taken stay out of the resolvable set. */
export function atdSkillsNotInstalled(
  takenNames: ReadonlySet<string>,
  discovered: readonly SkillRevisionRecord[],
): SkillRevisionRecord[] {
  return discovered.filter((skill) => !takenNames.has(skill.name));
}

/**
 * Merge order: installed plugin skills, then ATD skills whose names are free,
 * then `~/.agents/skills` names that are still free. Plugin skill names are qualified
 * (`<plugin>:<item>`), so they never take a host skill's bare name.
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
  // Host skills keep bare item names; only installed plugins contribute qualified ones.
  if (!isItemName(skill.name)) {
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
