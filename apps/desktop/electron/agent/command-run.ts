import {
  MAX_INPUT_CHIPS,
  MAX_RUN_REFERENCES,
  MAX_RUN_SKILLS,
  instructionCapabilities,
  instructionReferenceKey,
  parseInstructionTokens,
  type InputChip,
  type InputChipRange,
  type InstructionReference,
  type RunReference,
} from '@ai/agent-contracts';
import type { CommandDefinition } from './command-schema';
import type { RunStaging } from './run-staging';

/**
 * What a command run stages and shows, derived from the command's saved template. The template
 * is the only source: rendered text also holds user-supplied `{{input}}`, which must not be able
 * to add skills or references to a run.
 */
export interface CommandRunTokens {
  skills: string[];
  references: RunReference[];
  /** `instructionReferenceKey` of every template token; rendered tokens outside it stay text. */
  keys: ReadonlySet<string>;
}

export function commandRunTokens(
  command: Pick<CommandDefinition, 'instructions'>,
): CommandRunTokens {
  const tokens = parseInstructionTokens(command.instructions);
  return {
    ...instructionCapabilities(tokens),
    keys: new Set(tokens.map((token) => instructionReferenceKey(token.reference))),
  };
}

/**
 * The policy's staging plus the template's skills and references, each item once (the policy's
 * entry wins, keeping a pinned skill revision). Validation keeps a template within the run caps,
 * so only the combination can exceed them; that is refused rather than silently cut.
 */
export function withCommandTokens(
  staging: RunStaging | null,
  tokens: CommandRunTokens,
): RunStaging | null {
  if (!tokens.skills.length && !tokens.references.length) return staging;
  const skills = [...(staging?.skills ?? [])];
  for (const name of tokens.skills)
    if (!skills.some((skill) => skill.name === name)) skills.push({ name });
  const references = [...(staging?.references ?? [])];
  const keys = new Set(references.map(instructionReferenceKey));
  for (const reference of tokens.references)
    if (!keys.has(instructionReferenceKey(reference))) references.push(reference);
  if (skills.length > MAX_RUN_SKILLS)
    throw new Error(`This command and your selection load more than ${MAX_RUN_SKILLS} skills.`);
  if (references.length > MAX_RUN_REFERENCES)
    throw new Error(
      `This command and your selection mention more than ${MAX_RUN_REFERENCES} subagents, MCP servers and conversations.`,
    );
  return {
    ...staging,
    ...(skills.length ? { skills } : {}),
    ...(references.length ? { references } : {}),
  };
}

function chipOf(reference: InstructionReference, taskTitle: (taskId: string) => string): InputChip {
  if (reference.kind !== 'task') return reference;
  return {
    kind: 'task',
    taskId: reference.taskId,
    title: taskTitle(reference.taskId).slice(0, 1024),
  };
}

/**
 * Transcript chips for a command run's rendered `text`: its tokens that the template holds, in
 * document order (so ranges ascend without overlap), capped like composer chips. A conversation
 * chip shows `taskTitle`, which falls back to the id when the title is unknown.
 */
export function commandRunChips(
  text: string,
  tokens: CommandRunTokens,
  taskTitle: (taskId: string) => string,
): InputChipRange[] {
  return parseInstructionTokens(text)
    .filter((token) => tokens.keys.has(instructionReferenceKey(token.reference)))
    .slice(0, MAX_INPUT_CHIPS)
    .map((token) => ({
      from: token.from,
      to: token.to,
      chip: chipOf(token.reference, taskTitle),
    }));
}
