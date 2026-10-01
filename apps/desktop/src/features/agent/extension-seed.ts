import type { ExtensionSessionKind } from '../../client/agent/bridge';
import type { RunPolicy } from '../../client/agent/run-policy';
import { serialize, type ComposerDraft } from '../composer-editor/draft';

/**
 * The new draft and policy a create-with-AI session (Extensions, Memory) starts from: the kind's
 * `create-*` skill chip and a space, then `sentence` (an edit target, a turn to remember, or
 * nothing for the user to complete). Submit stages the chip's skill, so removing the chip also
 * drops the skill.
 */
export function extensionSeed(
  kind: ExtensionSessionKind,
  sentence: string,
): { draft: ComposerDraft; policy: RunPolicy } {
  return {
    draft: serialize([{ kind: 'skill', name: `create-${kind}` }, ' ', sentence], []),
    policy: {
      // Memory writes use the memory tools `memory` enables; `read` (with its search tools) lets
      // the user point at a file to remember from. The other skills write files.
      tools: kind === 'memory' ? ['read'] : ['read', 'write', 'edit', 'bash', 'command'],
      memory: true,
      useDefaultModel: false,
      confirmExpansion: false,
    },
  };
}
