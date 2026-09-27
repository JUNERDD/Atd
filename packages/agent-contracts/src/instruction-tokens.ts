import { MAX_RUN_REFERENCES, type RunReference } from './references.js';
import { MAX_RUN_SKILLS } from './skills.js';

/**
 * A capability written into saved command instructions: what a composer chip carries, minus
 * files (a command takes files at run time through `{{files}}`). Instructions stay plain text, so
 * each reference is a typed token that names its item by identity:
 *
 * - `/skill:<name>` loads that skill for the run, like a composer skill chip;
 * - `@agent:<name>` registers and allows that `~/.atd/agents` subagent;
 * - `@mcp:<serverId>` suggests that MCP server's tools;
 * - `@task:<taskId>` injects a bounded excerpt of that conversation.
 *
 * The command editor shows tokens as chips, the command tool writes them as text, and a command
 * run stages the template's tokens exactly as a composer submit stages its chips.
 */
export type InstructionReference =
  | { kind: 'skill'; name: string }
  | { kind: 'agent'; name: string }
  | { kind: 'mcpServer'; serverId: string }
  | { kind: 'task'; taskId: string };

/** A token and its `[from, to)` UTF-16 range in the text it was parsed from. */
export interface InstructionToken {
  from: number;
  to: number;
  reference: InstructionReference;
}

const PREFIXES = {
  skill: '/skill:',
  agent: '@agent:',
  mcpServer: '@mcp:',
  task: '@task:',
} as const satisfies Record<InstructionReference['kind'], string>;

/**
 * A token starts the text or follows whitespace, a quote, an opening bracket, `=`, or CJK
 * punctuation (the composer's token rule), so URLs, paths and e-mail addresses never read as
 * tokens. The name runs over the identifier alphabet and stops at anything else, so trailing
 * punctuation stays text.
 */
const TOKEN =
  /(?<![^\s"'“”‘’([{=　-〿！-／：-？])(\/skill:|@agent:|@mcp:|@task:)([A-Za-z0-9_-]{1,128})(?![A-Za-z0-9_-])/g;
/** Skill names must also start with a letter or digit (`SkillName`). */
const SKILL_NAME = /^[A-Za-z0-9]/;

function referenceOf(prefix: string, name: string): InstructionReference | null {
  switch (prefix) {
    case PREFIXES.skill:
      return SKILL_NAME.test(name) ? { kind: 'skill', name } : null;
    case PREFIXES.agent:
      return { kind: 'agent', name };
    case PREFIXES.mcpServer:
      return { kind: 'mcpServer', serverId: name };
    case PREFIXES.task:
      return { kind: 'task', taskId: name };
    default:
      return null;
  }
}

/** The token text of a reference; `parseInstructionTokens` reads it back as the same reference. */
export function instructionTokenText(reference: InstructionReference): string {
  switch (reference.kind) {
    case 'skill':
    case 'agent':
      return `${PREFIXES[reference.kind]}${reference.name}`;
    case 'mcpServer':
      return `${PREFIXES.mcpServer}${reference.serverId}`;
    case 'task':
      return `${PREFIXES.task}${reference.taskId}`;
  }
}

/** Every token in `text`, in document order. */
export function parseInstructionTokens(text: string): InstructionToken[] {
  const tokens: InstructionToken[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const reference = referenceOf(match[1] ?? '', match[2] ?? '');
    if (reference) tokens.push({ from: match.index, to: match.index + match[0].length, reference });
  }
  return tokens;
}

/** Identity of the referenced item, shared by equal tokens. */
export function instructionReferenceKey(reference: InstructionReference): string {
  return instructionTokenText(reference);
}

/**
 * What a run stages for these tokens: skill names and run references, each item once, in
 * document order. Callers check `instructionTokenProblem` first, so nothing is cut at the caps.
 */
export function instructionCapabilities(tokens: readonly InstructionToken[]): {
  skills: string[];
  references: RunReference[];
} {
  const skills = new Set<string>();
  const references = new Map<string, RunReference>();
  for (const { reference } of tokens) {
    if (reference.kind === 'skill') skills.add(reference.name);
    else references.set(instructionReferenceKey(reference), reference);
  }
  return { skills: [...skills], references: [...references.values()] };
}

/**
 * Why these instructions cannot be saved, in English for service and main-process errors, or
 * null. A run stages at most `MAX_RUN_SKILLS` skills and `MAX_RUN_REFERENCES` references.
 */
export function instructionTokenProblem(text: string): string | null {
  const { skills, references } = instructionCapabilities(parseInstructionTokens(text));
  if (skills.length > MAX_RUN_SKILLS)
    return `Instructions can load at most ${MAX_RUN_SKILLS} skills.`;
  if (references.length > MAX_RUN_REFERENCES)
    return `Instructions can mention at most ${MAX_RUN_REFERENCES} subagents, MCP servers and conversations.`;
  return null;
}
