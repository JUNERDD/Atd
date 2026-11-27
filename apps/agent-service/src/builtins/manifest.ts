import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_SKILL_ENTRIES } from './skill-entries.js';

/**
 * Built-in resources the service writes into user-editable locations, and the versions it has
 * shipped. The current content is always computed from what this build ships (the skill template
 * directory, the default role in builtins/role.ts), never listed here.
 *
 * When shipped content changes, bump `version` and keep the fingerprint of every released version
 * in `history`, oldest first; a version reaches `history` once a release tag ships it. An
 * untouched copy upgrades on its own: one whose install record still matches it, or, without a
 * record, one equal to a released version. Any other copy is the user's: an edit of the content
 * this build ships is kept; one based on other content is, for a product skill, backed up and
 * replaced (builtins/skills.ts), and for the default role kept with an update offered to restore;
 * builtins/reconcile.ts decides which applies to a copy.
 * Fingerprints come from builtins/fingerprint.ts; for a released skill,
 * fingerprint its directory as `git archive <tag>` extracts it.
 */
export interface BuiltinEntry {
  /** `skill:<name>` or `role:<id>`; the restore route takes it URL-encoded. */
  id: string;
  kind: 'skill' | 'role';
  /** Skill directory name, or role id. */
  name: string;
  version: number;
  /** Fingerprints of every shipped version (see the module comment). */
  history: readonly string[];
}

/** What a builtin resource's copy is relative to the shipped version. */
export type BuiltinState = 'current' | 'modified' | 'update_available';

/**
 * Wire status of one builtin resource; `version` is the shipped version. `backupPath` is where a
 * reconcile backed up the user's changed copy before replacing it, until they dismiss the notice.
 */
export interface BuiltinStatus {
  id: string;
  version: number;
  status: BuiltinState;
  backupPath?: string;
}

/**
 * Product skills, installed as whole directories into `<atdHome>/skills/<name>`. Each `history`
 * holds the fingerprints of the versions releases shipped, oldest first, with the first tag that
 * shipped each.
 */
export const BUILTIN_SKILLS: readonly BuiltinEntry[] = BUILTIN_SKILL_ENTRIES;

/** The builtin default role in `<dataDir>/skills/roles.json`; every release shipped the same one. */
export const DEFAULT_ROLE_BUILTIN: BuiltinEntry = {
  id: 'role:default',
  kind: 'role',
  name: 'default',
  version: 1,
  history: [],
};

export function builtinEntry(id: string): BuiltinEntry | undefined {
  return id === DEFAULT_ROLE_BUILTIN.id
    ? DEFAULT_ROLE_BUILTIN
    : BUILTIN_SKILLS.find((entry) => entry.id === id);
}

/** Whether an `<atdHome>/skills` entry is a product skill: the service owns its slot. */
export function isBuiltinSkill(name: string): boolean {
  return BUILTIN_SKILLS.some((entry) => entry.name === name);
}

/**
 * Skill templates ship beside `dist/` (and next to `src/` in the repo). Both
 * `src/builtins/*.ts` and `dist/builtins/*.js` resolve to `../../product-skills`.
 */
export function builtinSkillsTemplateDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'product-skills');
}
