import { readFile } from 'node:fs/promises';

/**
 * Read-only access to a skill's own files. A run captures each skill's
 * SKILL.md body once, at freeze (skills/run-skills.ts); the model reads the
 * skill's other files (references, assets) itself through the read tool,
 * which allows the run's skill directories. Skill text never authorizes a
 * write to user files.
 */
const MAX_BODY_CHARS = 256 * 1024;

/**
 * The SKILL.md body without its frontmatter, capped at 256K characters.
 * Throws when the file cannot be read, so a caller can report the skill
 * instead of injecting an empty body.
 */
export async function readSkillBody(entry: string): Promise<string> {
  return stripFrontmatter(await readFile(entry, 'utf8')).slice(0, MAX_BODY_CHARS);
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw.trim();
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 4).trim();
}
