import { LOAD_SKILL_TOOL } from '@atd/agent-contracts';
import { catalogDescription, escapeXml, plural, renderCatalog } from '../prompt-catalog.js';
import { roleAllowedSkills, type RoleSnapshotRecord } from './roles.js';
import type { SkillCatalog, SkillRevisionRecord } from './versions.js';

/** Most characters the catalog section puts into context; it counts against the run's budget. */
const MAX_CATALOG_CHARS = 8000;

/** One catalog skill as a run froze it: what the catalog lists and what `load_skill` reads. */
export interface CatalogSkill {
  name: string;
  description: string;
  /** SKILL.md path. */
  entry: string;
  /** The skill's directory; its references resolve here. */
  baseDir: string;
}

/**
 * The skills a run's model is told about, frozen with the run (run-freeze.ts). `invocable` may be
 * loaded with `load_skill`; `userOnly` skills (`disable-model-invocation`) start only from the
 * user's `/` selection. `text` is the system prompt's catalog section (skills/session-catalog.ts),
 * empty when both lists are.
 */
export interface RunSkillCatalog {
  invocable: CatalogSkill[];
  userOnly: CatalogSkill[];
  text: string;
}

export const EMPTY_SKILL_CATALOG: RunSkillCatalog = {
  invocable: [],
  userOnly: [],
  text: '',
};

/**
 * Freezes the catalog for one run from the catalog its skill freeze resolved against: the latest
 * revision per name, minus harness-disabled names, minus skills the run's role does not allow
 * (roleAllowedSkills, the capability snapshot's own rule). Revisions are not pinned: a skill
 * removed during the run fails to load with an error instead.
 */
export function freezeSkillCatalog(
  catalog: SkillCatalog,
  role: RoleSnapshotRecord,
  revokedSkills: readonly string[],
): RunSkillCatalog {
  const latest = new Map<string, SkillRevisionRecord>();
  // Installed revisions are listed oldest first, so the last record of a name is its latest.
  for (const record of catalog.all)
    if (!catalog.disabled.has(record.name)) latest.set(record.name, record);
  const allowed = new Set(roleAllowedSkills(role, revokedSkills, [...latest.keys()]));
  const records = [...latest.values()]
    .filter((record) => allowed.has(record.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toSkill = ({ name, description, entry, baseDir }: SkillRevisionRecord): CatalogSkill => ({
    name,
    description,
    entry,
    baseDir,
  });
  const invocable = records.filter((record) => !record.disableModelInvocation).map(toSkill);
  const userOnly = records.filter((record) => record.disableModelInvocation).map(toSkill);
  return { invocable, userOnly, text: catalogText(invocable, userOnly) };
}

const INTRO =
  'These are the skills available in this app. A skill is a reusable package of instructions.';
const LOADABLE_RULE = `Load one with the ${LOAD_SKILL_TOOL} tool only when the task clearly matches its description. A skill already loaded in this conversation, by the user's / selection or an earlier ${LOAD_SKILL_TOOL} call, is already in context and should not be loaded again.`;
const USER_ONLY_RULE =
  'User-only skills can only be started by the user, by typing / in the composer.';

/**
 * The catalog section text, at most MAX_CATALOG_CHARS (renderCatalog). Over budget, trailing
 * entries lose their descriptions first, then are left out with a count line, then trailing
 * user-only names are left out with a count; the totals line always gives exact counts. Empty
 * when there is nothing to list.
 */
function catalogText(invocable: CatalogSkill[], userOnly: CatalogSkill[]): string {
  if (!invocable.length && !userOnly.length) return '';
  const names = userOnly.map((skill) => skill.name);
  const preamble = [
    INTRO,
    ...(invocable.length ? [LOADABLE_RULE] : []),
    ...(names.length ? [USER_ONLY_RULE] : []),
  ].join(' ');
  return renderCatalog({
    preamble,
    open: '<available_skills>',
    close: '</available_skills>',
    entries: invocable.map((skill) => {
      const name = `<name>${escapeXml(skill.name)}</name>`;
      const description = escapeXml(catalogDescription(skill.description));
      return {
        full: `<skill>${name}<description>${description}</description></skill>`,
        bare: `<skill>${name}</skill>`,
      };
    }),
    omitted: (count) => `${count} more ${plural(count, 'skill')} omitted.`,
    totals: (shown) => totalsLine(invocable.length, names, shown),
    tail: names.length,
    maxChars: MAX_CATALOG_CHARS,
  }).text;
}

/** "N skills can be loaded; K more are user-only: a, b." with exact counts. */
function totalsLine(loadable: number, userOnly: string[], shown: number): string {
  const head = `${loadable} ${plural(loadable, 'skill')} can be loaded`;
  if (!userOnly.length) return `${head}.`;
  const hidden = userOnly.length - shown;
  const listed = userOnly.slice(0, shown).map(escapeXml).join(', ');
  const rest = hidden ? `${listed ? `${listed}, ` : ''}and ${hidden} not listed` : listed;
  return `${head}; ${userOnly.length} more ${userOnly.length === 1 ? 'is' : 'are'} user-only: ${rest}.`;
}

/**
 * The skills a catalog section lists, loadable and user-only, read from its totals line (exact
 * even when entries were left out); null for text without one.
 */
export function catalogSkillCount(text: string): number | null {
  const totals = /^(\d+) skills? can be loaded(?:; (\d+) more (?:is|are) user-only:.*)?\.$/.exec(
    text.split('\n').at(-1) ?? '',
  );
  return totals ? Number(totals[1]) + Number(totals[2] ?? 0) : null;
}
