import {
  instructionCapabilities,
  instructionTokenText,
  MAX_RUN_SKILLS,
  parseInstructionTokens,
} from '@atd/agent-contracts';

/** `ServiceCommandFullSchema`'s instructions limit, which a folded command must still meet. */
const INSTRUCTIONS_LIMIT = 20000;

/** The token text of a legacy skill name, or null when the name cannot read back as one token. */
function skillToken(name: string): string | null {
  const text = instructionTokenText({ kind: 'skill', name });
  const [token] = parseInstructionTokens(text);
  return token?.to === text.length ? text : null;
}

function legacySkillNames(skills: unknown): string[] {
  if (!Array.isArray(skills)) return [];
  return skills.flatMap((skill: unknown) =>
    typeof skill === 'object' && skill && 'name' in skill && typeof skill.name === 'string'
      ? [skill.name]
      : [],
  );
}

/** Prefixes `/skill:` tokens for `names` the instructions do not load yet, within both caps. */
function withSkillTokens(instructions: string, names: string[]): string {
  const loaded = new Set(instructionCapabilities(parseInstructionTokens(instructions)).skills);
  const tokens: string[] = [];
  let length = instructions.length;
  for (const name of names) {
    const token = loaded.has(name) ? null : skillToken(name);
    if (!token) continue;
    if (loaded.size >= MAX_RUN_SKILLS || length + token.length + 1 > INSTRUCTIONS_LIMIT) break;
    loaded.add(name);
    tokens.push(token);
    length += token.length + 1;
  }
  return tokens.length ? `${tokens.join(' ')} ${instructions}` : instructions;
}

/**
 * A command without the selection it carried before skills and subagents moved into its
 * instructions: a `skills` list (stored, never applied at run time) becomes leading `/skill:`
 * tokens, skipping names the instructions already load or that cannot be tokens and stopping at
 * the instructions limit or `MAX_RUN_SKILLS`; `skills` and `roleId` are dropped. Idempotent, and
 * the same object when neither key is present.
 */
export function withoutLegacySelection<T extends { instructions: string }>(command: T): T {
  if (!('skills' in command) && !('roleId' in command)) return command;
  const {
    skills,
    roleId: _roleId,
    ...rest
  } = command as T & { skills?: unknown; roleId?: unknown };
  // Only the two undeclared legacy keys are removed, so the rest is still a T.
  return {
    ...rest,
    instructions: withSkillTokens(command.instructions, legacySkillNames(skills)),
  } as unknown as T;
}
