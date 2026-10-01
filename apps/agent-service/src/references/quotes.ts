import type { TaskInput } from '@ai/agent-contracts';

const INTRO =
  "The user quoted the following passages from answers earlier in this task. Each quote's @ token in the message stands for the passage quoted under it.";

/** A message's quoted passages as its run reads them. */
export interface QuoteMaterial {
  /** The rendered quotes for the run material; empty when the message quotes nothing. */
  text: string;
  /** Distinct passages rendered. */
  passages: number;
}

/**
 * Renders the passages a message quotes. A quote chip carries its passage in the chip record, so
 * this reads only the input: each quote in message order, a passage quoted twice once, named by
 * the token the message shows for its chip. Quotes are the user's own input: their text counts
 * against the run's input budget (tasks/run-budget.ts) and always reaches the run, while
 * references fill only the room left (references/material.ts).
 */
export function quoteMaterial(input: Pick<TaskInput, 'text' | 'chips'>): QuoteMaterial {
  const tokens = new Map<string, string>();
  for (const { from, to, chip } of input.chips ?? [])
    if (chip.kind === 'quote' && !tokens.has(chip.text))
      tokens.set(chip.text, input.text.slice(from, to));
  if (!tokens.size) return { text: '', passages: 0 };
  const blocks = [...tokens].map(
    ([passage, token]) => `Quote ${token}:\n<quoted-passage>\n${passage}\n</quoted-passage>`,
  );
  return { text: [INTRO, ...blocks].join('\n\n'), passages: tokens.size };
}
