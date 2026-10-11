import { writesBack, type CommandOutput, type CommandWriteAction } from '@atd/agent-contracts';

/** Where a write-back action puts the final answer, as the model is told. */
const WRITE_PLACE: Record<CommandWriteAction, string> = {
  replaceSelection: 'replacing the selected text',
  insertAfterSelection: 'right after the selected text',
  insertAtCursor: 'at the cursor',
};

/**
 * The directive that tells the model its final answer is used as is, so it answers with the bare
 * text. Null for `panel`, whose answer is only read in the conversation. Delivered with the run's
 * hidden material (`RunSnapshot.instructions`), never in the visible prompt.
 */
export function outputInstruction(output: CommandOutput): string | null {
  const { action } = output;
  if (writesBack(action))
    return `Your final answer will be written verbatim into the user's app, ${WRITE_PLACE[action]}. Reply with only that text: no preamble, explanation, quotes or code fences. Match the language and formatting of the surrounding text unless the instructions say otherwise.`;
  if (action === 'copy')
    return 'Your final answer will be copied to the clipboard as is. Reply with only the text to copy: no preamble, explanation, quotes or code fences.';
  return null;
}
