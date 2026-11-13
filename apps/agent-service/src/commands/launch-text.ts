import {
  instructionReferenceKey,
  MAX_INPUT_CHIPS,
  parseInstructionTokens,
  type InputChip,
  type InputChipRange,
  type InstructionReference,
  type InstructionToken,
} from '@atd/agent-contracts';
import type { Ledger } from '../ledger.js';

/**
 * The text a command run submits and the transcript chips in it: the rendered template, framed by
 * an automation's text before and after it, and chips for exactly the template's own tokens.
 */

/** Where the rendered template sits in a run's text. */
export interface Span {
  from: number;
  to: number;
}

/** The rendered template with the frame's text before and after it, joined with blank lines. */
export function framed(
  rendered: string,
  frame: { before?: string; after?: string } | undefined,
): { text: string; span: Span } {
  const before = frame?.before ? `${frame.before}\n\n` : '';
  const after = frame?.after ? `\n\n${frame.after}` : '';
  const span = { from: before.length, to: before.length + rendered.length };
  return { text: `${before}${rendered}${after}`, span };
}

/**
 * Transcript chips for a command run's rendered `text`: its tokens that the template holds, found
 * within the template's `span`, in document order (so ranges ascend without overlap), capped like
 * composer chips. A conversation chip shows that task's title, or its id when the task is gone.
 */
export function commandChips(
  text: string,
  span: Span,
  template: readonly InstructionToken[],
  ledger: Ledger,
): InputChipRange[] {
  const keys = new Set(template.map((token) => instructionReferenceKey(token.reference)));
  return parseInstructionTokens(text)
    .filter((token) => token.from >= span.from && token.to <= span.to)
    .filter((token) => keys.has(instructionReferenceKey(token.reference)))
    .slice(0, MAX_INPUT_CHIPS)
    .map((token) => ({ from: token.from, to: token.to, chip: chipOf(token.reference, ledger) }));
}

function chipOf(reference: InstructionReference, ledger: Ledger): InputChip {
  if (reference.kind !== 'task') return reference;
  const title = ledger.data.tasks.find((task) => task.id === reference.taskId)?.title;
  return {
    kind: 'task',
    taskId: reference.taskId,
    title: (title || reference.taskId).slice(0, 1024),
  };
}
