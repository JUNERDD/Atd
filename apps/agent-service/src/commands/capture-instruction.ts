import {
  CAPTURE_BLOCK_MARKER,
  landsOnScreenshot,
  type CaptureAnswerAction,
  type CommandOutputAction,
  type CommandScreenshotText,
} from '@atd/agent-contracts';

/**
 * The hidden output instruction of a run on text recognized in a screenshot: how the selection is
 * laid out, what the run promises about its scope, and how the answer is written so the app can
 * put it where the run's output says (the capture answer grammar in
 * `@atd/agent-contracts/capture-answer.ts`, whose parser reads it back).
 */

const MARKER = `${CAPTURE_BLOCK_MARKER}<id>`;

/**
 * Which message of a screenshot-text run the instruction goes with: the `run` that reads the
 * selection; a `followUp` that makes a new version of its answer, which reads it earlier in the
 * conversation; or a `reread` follow-up that makes the new version for text the user picked anew,
 * which comes after the instruction (`followUpInstruction`).
 */
export type ScreenshotTextTurn = 'run' | 'followUp' | 'reread';

/** How the selection reads, for every output. */
function layout(paragraphs: number, turn: ScreenshotTextTurn): string {
  const count = paragraphs === 1 ? 'one paragraph' : `${paragraphs} paragraphs`;
  const markers = `Each paragraph starts with a marker line \`${MARKER}\` (such as \`${CAPTURE_BLOCK_MARKER}p1\`) and its text follows on the next lines.`;
  const asks = `This message asks for a new version of your answer about text recognized in a screenshot of the user's screen`;
  if (turn === 'followUp')
    return `${asks}, which came earlier in this conversation as ${count} (the latest such text, when the user changed it). ${markers} Write the whole new answer for those same paragraphs, changed as this message asks, following the rules below.`;
  if (turn === 'reread')
    return `${asks}. The user changed which text it covers: it now comes as ${count} at the end of these instructions, in place of the text before, and the screenshot as it shows now is attached for context. ${markers} Write the whole new answer for these paragraphs, changed as this message asks, following the rules below.`;
  return `The selected text was recognized in a screenshot of the user's screen, which is attached for context, and comes as ${count}. ${markers}`;
}

/**
 * What the answer covers. Picked paragraphs each get an answer; with nothing picked, the run reads
 * all the text, so the answer leads with the overall meaning and says how much it covered. Neither
 * may quietly shrink to one paragraph.
 */
function scope(run: CommandScreenshotText, action: CommandOutputAction): string {
  if (action === 'replaceSelection')
    return 'Give every paragraph its block, even one that stays as it is.';
  if (run.scope === 'picked')
    return 'The user picked these paragraphs, so your answer must cover every one of them; never leave one out or answer only one.';
  return `The user picked nothing, so this is all the text in the screenshot: start with its overall meaning in a sentence or two, saying how many of the ${run.paragraphs} paragraphs your answer covers, then treat every paragraph worth treating; never answer only one.`;
}

/** Where the answer's overall note goes: before its first block; required when it reads all the text. */
function lead(run: CommandScreenshotText): string {
  return run.scope === 'all'
    ? 'Write that overall meaning as plain lines before the first block.'
    : 'You may start with a short overall note, as plain lines before the first block.';
}

/** The block format for an answer that lands on the screenshot. */
const FORMATS: Record<CaptureAnswerAction, (run: CommandScreenshotText) => string> = {
  replaceSelection: () =>
    `Your answer replaces the paragraphs on the screenshot. Reply with only one block per paragraph, in the order given: its marker line \`${MARKER}\` exactly as given, then on the next lines the text that takes its place. A paragraph that needs no change repeats its text. Write nothing before the first block or after the last: no preamble, explanation, quotes or code fences. Match the language and formatting of each paragraph unless the instructions say otherwise.`,
  insertAfterSelection: (run) =>
    `Your answer marks paragraphs on the screenshot with numbered steps, and your notes are listed by the same numbers beside it. ${lead(run)} Then write one block per paragraph you treat, in the order given: its marker line \`${MARKER}\` exactly as given, then on the next lines your note on that paragraph. Each block becomes one numbered step. Use no other markers, quotes or code fences.`,
  annotate: (run) =>
    `Your answer marks text on the screenshot with the app's highlighter and numbered steps, and your notes are listed beside it. ${lead(run)} Then write one block per mark, in reading order, each starting with a marker line: \`${MARKER} highlight\` highlights the whole paragraph, \`${MARKER} highlight «phrase»\` only that phrase, copied exactly from the paragraph, and \`${MARKER} step\` puts a numbered step on the paragraph. On the lines after a marker line, write its note: optional for a highlight, required for a step. A paragraph may take several marks. Use no other markers, quotes or code fences.`,
};

/**
 * The hidden instruction of a run on screenshot text with output `action` over `run`'s
 * paragraphs, for the message `turn` names. An answer that lands on the screenshot is written in
 * blocks; any other answer is an ordinary one, which must not echo the markers (they only delimit
 * the recognized paragraphs), followed by `verbatim`, the directive of an output that uses the
 * answer as is (copied, or inserted at the cursor), when it has one.
 */
export function screenshotTextInstruction(
  action: CommandOutputAction,
  run: CommandScreenshotText,
  verbatim: string | null,
  turn: ScreenshotTextTurn,
): string {
  const head = layout(run.paragraphs, turn);
  // A replacement's scope rule refers to its blocks; the others' format refers to their scope.
  if (action === 'replaceSelection')
    return [head, FORMATS[action](run), scope(run, action)].join(' ');
  if (landsOnScreenshot(action)) return [head, scope(run, action), FORMATS[action](run)].join(' ');
  const parts = [
    head,
    'The marker lines only show where each recognized paragraph starts: never repeat or mention them, and answer about the text itself.',
    scope(run, action),
  ];
  return [...parts, ...(verbatim ? [verbatim] : [])].join(' ');
}
