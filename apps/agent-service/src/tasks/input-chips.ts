import type { InputChip, InputChipRange, RunSnapshot, TaskInput } from '@ai/agent-contracts';

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

/** The name a chip shows in the composer and the transcript. */
function chipName(chip: InputChip): string {
  switch (chip.kind) {
    case 'file':
    case 'agent':
    case 'skill':
      return chip.name;
    case 'task':
      return chip.title;
    case 'mcpServer':
      return chip.serverId;
  }
}

/** `text` as the user reads it: every chip's token replaced with the chip's name. */
function spellChips(text: string, chips: readonly InputChipRange[]): string {
  let spelled = '';
  let at = 0;
  for (const { from, to, chip } of chips) {
    spelled += text.slice(at, from) + chipName(chip);
    at = to;
  }
  return spelled + text.slice(at);
}

/**
 * A new task's title: its text (with chips, spelled by name on one line, so
 * `/skill:x explain` reads `x explain`), else its instruction, else a generic name.
 */
export function taskTitle(snapshot: RunSnapshot): string {
  const { text, chips } = snapshot.input;
  const readable = chips?.length ? spellChips(text, chips).replace(/\s+/g, ' ') : text;
  return readable.trim().slice(0, 120) || snapshot.instructions.slice(0, 120) || 'New task';
}
