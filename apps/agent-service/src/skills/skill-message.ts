import { createHash } from 'node:crypto';
import { LOAD_SKILL_TOOL } from '@ai/agent-contracts';
import type { TextContent } from '@earendil-works/pi-ai';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/** Custom type of the hidden message that carries skills to the model; transcripts never show it. */
export const APP_SKILL = 'app-skill';

/** How a companion skill is used; both preambles carry it, since a companion's block keeps its mark. */
const COMPANION_RULE =
  'A skill marked companion-of="<name>" is loaded for that skill: use it only where that skill\'s instructions call for it; it does not apply to the message on its own.';

const LOAD_PREAMBLE = `The /skill:<name> markers in the user message that follows refer to the skills below. Their SKILL.md bodies are already loaded here, so do not read SKILL.md again. Apply each skill to the request where its marker appears; a skill without a marker applies to the whole message. ${COMPANION_RULE}`;

const REATTACH_PREAMBLE = `Earlier parts of this conversation were compacted into a summary. The skills below were loaded in them and are re-attached here with their SKILL.md bodies, so do not read SKILL.md again. Keep applying each skill as the earlier requests asked. ${COMPANION_RULE}`;

/** One skill as a message carries it. */
export interface SkillBlock {
  name: string;
  /** First 32 hex digits of the SHA-256 of the body in `block`: the version the run applied. */
  revision: string;
  /** The skill element: name, SKILL.md location, base directory and body. */
  block: string;
}

const SkillMessageDetailsSchema = Type.Object({
  runId: Type.String(),
  skills: Type.Array(Type.Object({ name: Type.String(), revision: Type.String() })),
});

/**
 * `details` of a successful `load_skill` result whose single text part is the skill's block
 * (skills/load-skill-tool.ts). A result for a skill that was already loaded carries no block and
 * does not match.
 */
export const LoadSkillDetailsSchema = Type.Object({
  name: Type.String(),
  revision: Type.String(),
  baseDir: Type.String(),
});

export type LoadSkillDetails = Static<typeof LoadSkillDetailsSchema>;

/**
 * An `app-skill` message as Pi takes it from `before_agent_start` or `sendMessage`. Content part 0
 * is the preamble and part `i + 1` is the block of `details.skills[i]`, so a later compaction can
 * take each skill back out of the session exactly as it was sent.
 */
export interface SkillMessage {
  customType: typeof APP_SKILL;
  display: false;
  content: TextContent[];
  details: Static<typeof SkillMessageDetailsSchema>;
}

/**
 * Renders a skill the way Pi's own `/skill:` expansion does, so models see the familiar element.
 * A companion also names the skill that declares it (`companion-of`), which the preambles explain.
 */
export function skillBlock(
  skill: { name: string; location: string; baseDir: string; companionOf: string | null },
  body: string,
): string {
  const name = escapeAttribute(skill.name);
  const location = escapeAttribute(skill.location);
  const companion = skill.companionOf
    ? ` companion-of="${escapeAttribute(skill.companionOf)}"`
    : '';
  return `<skill name="${name}" location="${location}"${companion}>\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
}

/** The message that brings a run's skills in with its prompt. */
export function loadMessage(runId: string, skills: readonly SkillBlock[]): SkillMessage {
  return skillMessage(LOAD_PREAMBLE, runId, skills);
}

/** The message that brings back skills a compaction removed from context. */
export function reattachMessage(runId: string, skills: readonly SkillBlock[]): SkillMessage {
  return skillMessage(REATTACH_PREAMBLE, runId, skills);
}

/** The revision of a SKILL.md body: the first 32 hex digits of its SHA-256. */
export function skillRevision(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32);
}

/** Characters a message puts into the model context. */
export function contentChars(message: SkillMessage): number {
  return message.content.reduce((total, part) => total + part.text.length, 0);
}

/**
 * The skills a session entry brings into context: every skill of an `app-skill` message (the
 * user's `/` selection or a compaction's re-attach) and the skill of a successful `load_skill`
 * result. Other entries, and entries of another shape, carry none. This is the one reader for
 * whether a skill is loaded, so the `load_skill` dedupe and the compaction re-attach agree.
 */
export function readCarriedSkills(entry: SessionEntry): SkillBlock[] {
  const message = readSkillMessage(entry);
  if (message) return message;
  if (entry.type !== 'message') return [];
  const result = entry.message;
  if (result.role !== 'toolResult' || result.toolName !== LOAD_SKILL_TOOL || result.isError)
    return [];
  const [part, ...rest] = result.content;
  if (part?.type !== 'text' || rest.length || !Value.Check(LoadSkillDetailsSchema, result.details))
    return [];
  return [{ name: result.details.name, revision: result.details.revision, block: part.text }];
}

/** The skills an `app-skill` session entry carries; null for other entries or another shape. */
function readSkillMessage(entry: SessionEntry): SkillBlock[] | null {
  if (entry.type !== 'custom_message' || entry.customType !== APP_SKILL) return null;
  const { content, details } = entry;
  if (!Value.Check(SkillMessageDetailsSchema, details) || !Array.isArray(content)) return null;
  if (content.length !== details.skills.length + 1) return null;
  const skills = details.skills.map((skill, index) => {
    const part = content[index + 1];
    return part?.type === 'text'
      ? { name: skill.name, revision: skill.revision, block: part.text }
      : null;
  });
  return skills.every((skill) => skill !== null) ? skills : null;
}

function skillMessage(
  preamble: string,
  runId: string,
  skills: readonly SkillBlock[],
): SkillMessage {
  return {
    customType: APP_SKILL,
    display: false,
    content: [preamble, ...skills.map((skill) => skill.block)].map((text) => ({
      type: 'text',
      text,
    })),
    details: { runId, skills: skills.map(({ name, revision }) => ({ name, revision })) },
  };
}

/** Skill names are plain; a location may hold any path character. */
function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}
