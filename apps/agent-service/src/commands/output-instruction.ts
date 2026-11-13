import {
  writesBack,
  type CommandOutput,
  type CommandOutputAction,
  type CommandScreenshotText,
  type CommandWriteAction,
  type ScreenshotTextFollowUp,
} from '@atd/agent-contracts';
import { screenshotTextInstruction } from './capture-instruction.js';

/** Where a write-back action puts the final answer, as the model is told. */
const WRITE_PLACE: Record<CommandWriteAction, string> = {
  replaceSelection: 'replacing the selected text',
  insertAfterSelection: 'right after the selected text',
  insertAtCursor: 'at the cursor',
};

/**
 * The directive that tells the model its final answer is used as is, so it answers with the bare
 * text. Null for `panel`, `card` and `annotate` (a card wherever it does not mark a screenshot),
 * whose answer is read (in the conversation, or on the island's answer card).
 */
function verbatimInstruction(action: CommandOutputAction): string | null {
  if (writesBack(action))
    return `Your final answer will be written verbatim into the user's app, ${WRITE_PLACE[action]}. Reply with only that text: no preamble, explanation, quotes or code fences. Match the language and formatting of the surrounding text unless the instructions say otherwise.`;
  if (action === 'copy')
    return 'Your final answer will be copied to the clipboard as is. Reply with only the text to copy: no preamble, explanation, quotes or code fences.';
  return null;
}

/**
 * What the run's hidden material tells the model about where its answer goes, delivered with
 * `RunSnapshot.instructions`, never in the visible prompt: for a run on text recognized in a
 * screenshot (`screenshotText`), how to answer for that screenshot (`screenshotTextInstruction`);
 * for any other run, the directive of an output that uses the answer verbatim, or null when the
 * answer is only read.
 */
export function outputInstruction(
  output: CommandOutput,
  screenshotText?: CommandScreenshotText,
): string | null {
  const verbatim = verbatimInstruction(output.action);
  return screenshotText
    ? screenshotTextInstruction(output.action, screenshotText, verbatim, 'run')
    : verbatim;
}

/**
 * What a task run on screenshot text (`SubmitTaskRequest.screenshotText`) is told in hidden run
 * material:
 * - A fresh Ask or Regenerate (`isNewTask || screenshotText.turn === 'run'`) uses `'run'` with
 *   `selection` appended after the format rules.
 * - An adjustment follow-up on an existing task uses `'followUp'` when `selection` is empty, or
 *   `'reread'` with `selection` appended when the user picked other text since.
 */
export function screenshotTaskInstruction(
  screenshotText: ScreenshotTextFollowUp,
  selection: string,
  isNewTask: boolean,
): string {
  const { output } = screenshotText;
  const verbatim = verbatimInstruction(output);
  if (isNewTask || screenshotText.turn === 'run')
    return `${screenshotTextInstruction(output, screenshotText, verbatim, 'run')}\n\n${selection}`;
  const reread = selection.trim() !== '';
  if (!reread) return screenshotTextInstruction(output, screenshotText, verbatim, 'followUp');
  return `${screenshotTextInstruction(output, screenshotText, verbatim, 'reread')}\n\n${selection}`;
}

/**
 * Compatibility helper for a follow-up on an existing screenshot-text run (`isNewTask = false`).
 */
export function followUpInstruction(followUp: ScreenshotTextFollowUp, selection: string): string {
  return screenshotTaskInstruction(followUp, selection, false);
}
