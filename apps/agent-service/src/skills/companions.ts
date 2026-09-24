import { readFile } from 'node:fs/promises';
import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import type { SkillDiagnostic } from './diagnostics.js';
import type { SkillRevisionRecord } from './versions.js';

/** Frontmatter key naming the skills a skill brings along into the same run. */
const COMPANIONS_KEY = 'companion-skills';

/** A companion one of the run's requested skills declares. */
export interface CompanionRef {
  name: string;
  /** The requested skill that declares it. */
  of: string;
}

/**
 * The companions `skills` declare in their SKILL.md frontmatter (`companion-skills: [grill-me]`),
 * one level deep: companions of companions are not followed. Each name counts once, in declaration
 * order, and names already in `skills` are skipped. A SKILL.md that cannot be read is skipped here
 * (the run's capture reports it); a value that is not a list of names is a diagnostic.
 */
export async function companionRefs(
  skills: readonly SkillRevisionRecord[],
): Promise<{ refs: CompanionRef[]; diagnostics: SkillDiagnostic[] }> {
  const taken = new Set(skills.map((skill) => skill.name));
  const refs: CompanionRef[] = [];
  const diagnostics: SkillDiagnostic[] = [];
  for (const skill of skills) {
    let declared: unknown;
    try {
      const { frontmatter } = parseFrontmatter(await readFile(skill.entry, 'utf8'));
      declared = frontmatter[COMPANIONS_KEY];
    } catch {
      continue;
    }
    if (declared === undefined || declared === null) continue;
    if (!Array.isArray(declared) || !declared.every((name) => typeof name === 'string')) {
      diagnostics.push({
        type: 'warning',
        code: 'invalid_skill',
        message: `Skill "${skill.name}" declares ${COMPANIONS_KEY} that is not a list of skill names; no companions were loaded for it.`,
        skill: skill.name,
        path: skill.entry,
      });
      continue;
    }
    for (const name of declared as string[]) {
      if (taken.has(name)) continue;
      taken.add(name);
      refs.push({ name, of: skill.name });
    }
  }
  return { refs, diagnostics };
}

/** A companion left out because the run already holds the most skills one run may load. */
export function diagnoseCompanionLimit(ref: CompanionRef, limit: number): SkillDiagnostic {
  return {
    type: 'warning',
    code: 'not_run_available',
    message: `Companion skill "${ref.name}" of "${ref.of}" was not loaded: a run loads at most ${limit} skills.`,
    skill: ref.name,
  };
}
