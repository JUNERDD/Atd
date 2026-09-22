import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Read-only skill resource maps. Skill body, references and assets are
 * exposed as in-memory maps for prompt assembly and UI preview; install
 * declarations and skill text can never authorize a write to user files.
 */
export interface SkillResourceMaps {
  /** SKILL.md body without frontmatter, keyed by skill name. */
  content: ReadonlyMap<string, string>;
  /** references/** files, keyed by `name/relative-path`. */
  references: ReadonlyMap<string, string>;
  /** assets/** files, keyed by `name/relative-path`. */
  assets: ReadonlyMap<string, string>;
}

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 64;

/** Loads read-only maps for frozen skill entries; missing dirs yield empty maps. */
export async function loadSkillResourceMaps(
  skills: { name: string; entry: string; baseDir: string }[],
): Promise<SkillResourceMaps> {
  const content = new Map<string, string>();
  const references = new Map<string, string>();
  const assets = new Map<string, string>();
  for (const skill of skills.slice(0, 32)) {
    content.set(skill.name, await readBody(skill.entry));
    await collectDir(skill, 'references', references);
    await collectDir(skill, 'assets', assets);
  }
  return { content, references, assets };
}

async function readBody(entry: string): Promise<string> {
  try {
    const raw = await readFile(entry, 'utf8');
    return stripFrontmatter(raw).slice(0, MAX_FILE_BYTES);
  } catch {
    return '';
  }
}

async function collectDir(
  skill: { name: string; baseDir: string },
  dir: 'references' | 'assets',
  into: Map<string, string>,
): Promise<void> {
  let names: string[];
  try {
    names = await readdir(path.join(skill.baseDir, dir));
  } catch {
    return;
  }
  for (const name of names.slice(0, MAX_FILES)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    try {
      const text = await readFile(path.join(skill.baseDir, dir, name), 'utf8');
      into.set(`${skill.name}/${name}`, text.slice(0, MAX_FILE_BYTES));
    } catch {
      continue;
    }
  }
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw.trim();
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 4).trim();
}
