import type { ExtensionSessionKind } from '../../client/agent/bridge';
import type { RunPolicy } from '../../client/agent/run-policy';
import { serialize, type ComposerDraft } from '../composer-editor/draft';

/** What a create-with-AI session works on; the command editor hands off `command`. */
export type SeedKind = ExtensionSessionKind | 'command';

/** Tools each kind's `create-*` skill writes with; the others write files. */
const TOOLS: Partial<Record<SeedKind, RunPolicy['tools']>> = {
  // Memory writes use the memory tools `memory` enables; `read` (with its search tools) lets the
  // user point at a file to remember from.
  memory: ['read'],
  // Commands are saved through the `command` tool; `read` lets the user point at a prompt file.
  command: ['read', 'command'],
};

/**
 * The new draft and policy a create-with-AI session (Extensions, Memory, Commands) starts from:
 * the kind's `create-*` skill chip and a space, then `sentence` (an edit target, a turn to
 * remember, or nothing for the user to complete). Submit stages the chip's skill, so removing the
 * chip also drops the skill.
 */
export function extensionSeed(
  kind: SeedKind,
  sentence: string,
): { draft: ComposerDraft; policy: RunPolicy } {
  return {
    draft: serialize([{ kind: 'skill', name: `create-${kind}` }, ' ', sentence], []),
    policy: {
      tools: TOOLS[kind] ?? ['read', 'write', 'edit', 'bash', 'command'],
      memory: true,
      confirmExpansion: false,
    },
  };
}
