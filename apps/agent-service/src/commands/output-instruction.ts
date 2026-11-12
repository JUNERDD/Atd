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
 * What a follow-up that makes a new version of a screenshot-text run's answer is told, hidden as
 * the run's instruction was (`SubmitTaskRequest.screenshotText`): the same answer format for the
 * same output, so the new version lands where the first one would. Its paragraphs are the ones
 * read earlier, or `selection`, the follow-up's own, when the user picked other text since: they
 * then come with the instruction, as the run's came with its command.
 */
export function followUpInstruction(followUp: ScreenshotTextFollowUp, selection: string): string {
  const { output } = followUp;
  const reread = selection.trim() !== '';
  const verbatim = verbatimInstruction(output);
  if (!reread) return screenshotTextInstruction(output, followUp, verbatim, 'followUp');
  return `${screenshotTextInstruction(output, followUp, verbatim, 'reread')}\n\n${selection}`;
}
