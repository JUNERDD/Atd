import { access, copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Product skills seeded into ~/.atd/skills when missing. Never overwrite. */
const PRODUCT_SKILL_NAMES = ['create-skill', 'create-subagent', 'create-mcp'] as const;

/**
 * Templates ship beside `dist/` (and next to `src/` in the repo). Both
 * `src/skills/*.ts` and `dist/skills/*.js` resolve to `../../product-skills`.
 */
export function productSkillsTemplateDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'product-skills');
}

/** Copies each product skill into ~/.atd/skills when SKILL.md is absent. */
export async function ensureProductSkillsSeeded(): Promise<void> {
  const destRoot = path.join(homedir(), '.atd', 'skills');
  const templateRoot = productSkillsTemplateDir();
  await mkdir(destRoot, { recursive: true });
  for (const name of PRODUCT_SKILL_NAMES) {
    const destEntry = path.join(destRoot, name, 'SKILL.md');
    if (await exists(destEntry)) continue;
    const templateEntry = path.join(templateRoot, name, 'SKILL.md');
    await mkdir(path.dirname(destEntry), { recursive: true });
    await copyFile(templateEntry, destEntry);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
