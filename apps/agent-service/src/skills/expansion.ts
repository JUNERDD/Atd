import {
  diagnoseInvalidRef,
  diagnoseNotRunAvailable,
  type SkillDiagnostic,
} from './diagnostics.js';
import type { SkillSnapshotRecord } from './versions.js';

/** Parsed explicit `/skill:name args` entry; null means ordinary input. */
export interface ParsedSkillEntry {
  name: string;
  args: string;
}

export interface ExpansionDecision {
  isSkillCommand: boolean;
  allowed: boolean;
  skillName: string | null;
  args: string;
  /** True only for a validated explicit entry; ordinary input stays false. */
  expandPromptTemplates: boolean;
  diagnostics: SkillDiagnostic[];
}

const SKILL_PREFIX = '/skill:';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Parses `/skill:name args` without loader side effects. */
export function parseSkillEntry(text: string): ParsedSkillEntry | null {
  if (!text.startsWith(SKILL_PREFIX)) return null;
  const rest = text.slice(SKILL_PREFIX.length);
  const space = rest.indexOf(' ');
  const name = (space === -1 ? rest : rest.slice(0, space)).trim();
  if (!NAME_PATTERN.test(name)) return null;
  return { name, args: space === -1 ? '' : rest.slice(space + 1).trim() };
}

/**
 * Decides expansion for one Pi prompt entry. Ordinary input always resolves
 * to `expandPromptTemplates:false`. Explicit `/skill:name` validates the name
 * plus the frozen run snapshot and enables expansion for that entry only.
 */
export function decideExpansion(
  text: string,
  snapshot: SkillSnapshotRecord,
  runId: string,
): ExpansionDecision {
  const parsed = parseSkillEntry(text);
  if (!parsed) {
    if (text.startsWith(SKILL_PREFIX)) {
      const invalid = diagnoseInvalidRef(text.slice(SKILL_PREFIX.length).split(' ')[0] ?? '');
      return {
        isSkillCommand: true,
        allowed: false,
        skillName: null,
        args: '',
        expandPromptTemplates: false,
        diagnostics: invalid ? [invalid] : [],
      };
    }
    return {
      isSkillCommand: false,
      allowed: false,
      skillName: null,
      args: '',
      expandPromptTemplates: false,
      diagnostics: [],
    };
  }
  const frozen = snapshot.skills.some((skill) => skill.name === parsed.name);
  if (!frozen)
    return {
      isSkillCommand: true,
      allowed: false,
      skillName: parsed.name,
      args: parsed.args,
      expandPromptTemplates: false,
      diagnostics: [diagnoseNotRunAvailable(parsed.name, runId)],
    };
  return {
    isSkillCommand: true,
    allowed: true,
    skillName: parsed.name,
    args: parsed.args,
    expandPromptTemplates: true,
    diagnostics: [],
  };
}

/**
 * Pi prompt flag for this entry. Callers pass the result straight to
 * `session.prompt(text, { expandPromptTemplates })`; queued steer/followUp
 * entries are pre-validated the same way because Pi always expands there.
 */
export function expansionFlag(decision: ExpansionDecision): boolean {
  return decision.expandPromptTemplates;
}
