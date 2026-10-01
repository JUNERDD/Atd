import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InstallRecord } from './state.js';

/**
 * Built-in resources the service writes into user-editable locations, and the versions it has
 * shipped. The current content is always computed from what this build ships (the skill template
 * directory, the default role in builtins/role.ts), never listed here.
 *
 * Until the app has a public release, shipped content changes in place at version 1 with an empty
 * `history`. After it, when shipped content changes: bump `version` and keep every earlier
 * fingerprint in `history` (the current one may be added once released). A copy without an
 * install record whose fingerprint is in `history` is an untouched earlier install and upgrades;
 * any other copy is the user's and is kept. Fingerprints come from builtins/fingerprint.ts.
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

/** Wire status of one builtin resource; `version` is the shipped version. */
export interface BuiltinStatus {
  id: string;
  version: number;
  status: BuiltinState;
}

/** What reconciling one resource does. */
export type ReconcileAction = 'install' | 'record' | 'keep' | 'none';

function skill(name: string, version: number, history: string[]): BuiltinEntry {
  return { id: `skill:${name}`, kind: 'skill', name, version, history };
}

/**
 * Product skills, installed as whole directories into `<atdHome>/skills/<name>`. All are at
 * version 1 until the first public release (see above).
 */
export const BUILTIN_SKILLS: readonly BuiltinEntry[] = [
  skill('create-skill', 1, []),
  skill('create-subagent', 1, []),
  skill('create-mcp', 1, []),
  skill('plan-mode', 1, []),
  skill('grill-me', 1, []),
  skill('create-memory', 1, []),
];

/** The builtin default role in `<dataDir>/skills/roles.json`. */
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

/**
 * Decides what reconciling a copy does. Absent → install. Equal to the shipped content → record
 * it. Unmodified since the recorded install, or (without a record) equal to a shipped version →
 * install the shipped version over it. Anything else is the user's → keep it untouched.
 */
export function reconcileAction(
  entry: BuiltinEntry,
  copy: string | null,
  latest: string,
  recorded: InstallRecord | undefined,
): ReconcileAction {
  if (copy === null) return 'install';
  if (copy === latest)
    return recorded?.fingerprint === latest && recorded.version === entry.version
      ? 'none'
      : 'record';
  const unmodified = recorded ? copy === recorded.fingerprint : entry.history.includes(copy);
  return unmodified ? 'install' : 'keep';
}

/**
 * Status of a copy after reconciling: `current` when it holds the shipped content; otherwise the
 * user changed it. When the user edited the content this build ships (its recorded base is the
 * shipped fingerprint) that is `modified`; when the shipped content differs from their base (or
 * there is no record) it is `update_available`. Comparing fingerprints, not `version`, keeps the
 * status right even when shipped content changes without a version bump.
 */
export function builtinStatus(
  entry: BuiltinEntry,
  copy: string,
  latest: string,
  recorded: InstallRecord | undefined,
): BuiltinStatus {
  const status: BuiltinState =
    copy === latest
      ? 'current'
      : recorded?.fingerprint !== latest
        ? 'update_available'
        : 'modified';
  return { id: entry.id, version: entry.version, status };
}
