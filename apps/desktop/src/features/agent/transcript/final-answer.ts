import type { Block } from '../../../client/agent/transcript-schema';

/**
 * The final answer among `blocks`: the last assistant text, from run `runId` only when given. A
 * stopped turn can end in tool activity or an empty aborted message, so the answer is not always
 * the last block.
 */
export function lastAnswerText(blocks: readonly Block[], runId?: string): string {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind !== 'assistant' || !block.text.trim()) continue;
    if (runId === undefined || block.runId === runId) return block.text;
  }
  return '';
}
