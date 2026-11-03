import type { TaskInput } from '@atd/agent-contracts';

/**
 * Chip ranges must lie inside `text`, ascending and without overlap, or clients could not draw the
 * message around them; a bad request answers 400 instead of entering the ledger. Only the bounds
 * are checked: what a chip's token looks like is the composer's serialization, not this contract.
 */
export function checkChipRanges(input: TaskInput): void {
  let end = 0;
  input.chips?.forEach(({ from, to }, index) => {
    if (from < end || from >= to || to > input.text.length)
      throw new TypeError(
        `Invalid data: /input/chips/${index} must lie inside the text after the previous chip.`,
      );
    end = to;
  });
}
