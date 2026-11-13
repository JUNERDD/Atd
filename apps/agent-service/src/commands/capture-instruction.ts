import {
  CAPTURE_ANSWER_TOOL,
  landsOnScreenshot,
  type CaptureAnswerAction,
  type CommandOutputAction,
  type CommandScreenshotText,
} from '@atd/agent-contracts';

/**
 * The hidden output instruction of a run on text recognized in a screenshot: how the selection is
 * laid out, what the run promises about its scope, and how the answer is written via the
 * `mark_screenshot` tool (or plain Markdown when `annotate` needs no marks) so the app can apply
 * it where the run's output says.
 */

/**
 * Which message of a screenshot-text run the instruction goes with: the `run` that reads the
 * selection; a `followUp` that makes a new version of its answer, which reads it earlier in the
 * conversation; or a `reread` follow-up that makes the new version for text the user picked anew,
 * which comes after the instruction (`followUpInstruction`).
 */
export type ScreenshotTextTurn = 'run' | 'followUp' | 'reread';

/** How the screenshot and any recognized text selection read, for every output. */
function layout(paragraphs: number, turn: ScreenshotTextTurn): string {
  if (paragraphs === 0) {
    const asks =
      "This message asks for a new version of your answer about a screenshot of the user's screen";
    if (turn === 'followUp')
      return `${asks}, attached earlier in this conversation (the latest such screenshot, when the user changed it), in which no text paragraphs were recognized. Write the whole new answer for that screenshot, changed as this message asks, following the rules below.`;
    if (turn === 'reread')
      return `${asks}. The user changed the screenshot region: the updated screenshot is attached for context, and no text paragraphs were recognized in it. Write the whole new answer for this screenshot, changed as this message asks, following the rules below.`;
    return "This request is about the attached screenshot of the user's screen, in which no text paragraphs were recognized.";
  }
  const count = paragraphs === 1 ? 'one paragraph' : `${paragraphs} paragraphs`;
  const headers =
    'Each paragraph starts with a header line `[<id>]` or `[<id> @ x1,y1,x2,y2]` (such as `[p1]` or `[p1 @ 120,240,680,310]`, where `x1,y1,x2,y2` are normalized 0..1000 screenshot bounds), and its text follows on the next lines.';
  const asks =
    "This message asks for a new version of your answer about text recognized in a screenshot of the user's screen";
  if (turn === 'followUp')
    return `${asks}, which came earlier in this conversation as ${count} (the latest such text, when the user changed it). ${headers} Write the whole new answer for those same paragraphs, changed as this message asks, following the rules below.`;
  if (turn === 'reread')
    return `${asks}. The user changed which text it covers: it now comes as ${count} at the end of these instructions, in place of the text before, and the screenshot as it shows now is attached for context. ${headers} Write the whole new answer for these paragraphs, changed as this message asks, following the rules below.`;
  return `The selected text was recognized in a screenshot of the user's screen, which is attached for context, and comes as ${count}. ${headers}`;
}

/**
 * What the answer covers. Picked paragraphs each get an answer; with nothing picked, the run reads
 * all the text (or the image alone when `paragraphs === 0`): specific requests are answered
 * directly, while broad requests lead with the overall meaning.
 */
function scope(run: CommandScreenshotText, action: CommandOutputAction): string {
  if (action === 'replaceSelection')
    return 'Give every paragraph its item, even one that stays as it is.';
  if (run.paragraphs === 0)
    return 'Inspect the attached screenshot directly: when the request asks about a specific detail or task, answer that request directly; when the request covers the screenshot broadly, start with its overall meaning in a sentence or two.';
  if (run.scope === 'picked')
    return 'The user picked these paragraphs, so your answer must cover every one of them; never leave one out or answer only one.';
  return `The user picked nothing, so this is all the text in the screenshot: when the request asks about a specific detail or task, answer that request directly without summarizing unrelated paragraphs; when the request covers the screenshot broadly, start with its overall meaning in a sentence or two, saying how many of the ${run.paragraphs} paragraphs your answer covers, then treat every paragraph worth treating instead of shrinking to one.`;
}

/** Where the answer's overall note goes: in the `lead` field when covering the screenshot broadly. */
function lead(run: CommandScreenshotText): string {
  return run.scope === 'all'
    ? 'When your answer covers the screenshot broadly, put that overall meaning in `lead`; omit `lead` when answering a specific narrow request.'
    : 'You may put a short overall note in `lead`.';
}

const VISUAL_MARKS_RULE =
  'For UI controls, icons, diagrams, avatars, QR codes, images, or areas outside recognized text, use integer 0..1000 coordinates spanning the full attached screenshot from top-left `0,0` to bottom-right `1000,1000` (ignore any pixel-dimension notes in attachment metadata; use any `@ x1,y1,x2,y2` headers as spatial anchors for nearby elements; if a tall screenshot is split into `N` vertical pages, page `k` (`1..N`) spans `y` from `((k-1)*1000)/N` to `(k*1000)/N`): omit `paragraph` and pass `coords: { x1, y1, x2, y2 }` with `tool: "box"`, `"ellipse"`, `"arrow"` (shaft tail `x1,y1` in nearby clear space to arrowhead tip `x2,y2` pointing at the target), `"spotlight"`, or `"mosaic"`, or `tool: "step"` with `point: { x, y }` (or `coords` from badge `x1,y1` to target `x2,y2`). Put any note in `text`: required for `step`, optional for the others (never repeat redacted secrets in a mosaic note).';

/** The tool-call format for an answer that lands on the screenshot. */
const FORMATS: Record<CaptureAnswerAction, (run: CommandScreenshotText) => string> = {
  replaceSelection: (run) => {
    const base = 'Your answer replaces the paragraphs on the screenshot.';
    const rule =
      'Match the language and formatting of each paragraph unless the instructions say otherwise.';
    if (run.paragraphs <= 2)
      return `${base} Call \`${CAPTURE_ANSWER_TOOL}\` once with \`items\` containing one \`{ tool: "replace", paragraph, text }\` entry per paragraph in the order given (a paragraph that needs no change repeats its text), and omit \`lead\`. Do not write conversational text before or after the tool call. ${rule}`;
    return `${base} Emit parallel \`${CAPTURE_ANSWER_TOOL}\` tool calls in this same response, grouping 2-3 consecutive paragraphs per call in the exact order given so replacements stream progressively onto the screenshot: each call passes \`items\` containing \`{ tool: "replace", paragraph, text }\` entries (a paragraph that needs no change repeats its text) and omits \`lead\`. Do not write conversational text before, between, or after the tool calls. ${rule}`;
  },
  insertAfterSelection: (run) => {
    const base = `Your answer marks paragraphs on the screenshot with numbered steps, and your notes are listed by the same numbers beside it. ${lead(run)}`;
    if (run.paragraphs <= 2)
      return `${base} Call \`${CAPTURE_ANSWER_TOOL}\` once with \`items\` containing \`{ tool: "step", paragraph, text }\` entries in the order given; each item becomes one numbered step. Do not write conversational text outside the tool call.`;
    return `${base} Emit parallel \`${CAPTURE_ANSWER_TOOL}\` tool calls in this same response, grouping 2-3 consecutive paragraphs per call in the exact order given with \`items\` containing \`{ tool: "step", paragraph, text }\` entries (each item becomes one numbered step); put any \`lead\` on the first call only, and write no conversational text before, between, or after the tool calls.`;
  },
  annotate: (run) => {
    const hybrid = `Decide whether canvas marks help: when the user asks a pure question, explanation, translation, transcription, or summary where marking the screenshot adds nothing, reply directly in plain Markdown with 0 tool calls (do NOT call \`${CAPTURE_ANSWER_TOOL}\`; it displays cleanly on the result card beside the screenshot; never invent decorative marks). When the user asks to annotate, highlight, point out, box/circle, spotlight, number steps, or redact/mosaic/mask parts of the screenshot—or when pointing to specific elements helps answer—call \`${CAPTURE_ANSWER_TOOL}\` with \`items\` in reading or step order (once for up to 3 marks, or split into parallel \`${CAPTURE_ANSWER_TOOL}\` calls of 2-4 ordered items in this same response when placing more than 3 marks, putting any \`lead\` on the first call only), with no conversational text outside tool calls when calling \`${CAPTURE_ANSWER_TOOL}\`.`;
    const ocr =
      run.paragraphs > 0
        ? 'Prefer OCR `paragraph` marks whenever targeting recognized text (exact character-line bounds): `{ tool: "highlight", paragraph, phrase?, text? }` highlights the whole paragraph or an exact `phrase` copied from it, `{ tool: "step", paragraph, text }` puts a numbered step on the paragraph (note required), and `{ tool: "mosaic", paragraph, phrase?, text? }` pixelates/redacts the whole paragraph or `phrase` (note optional, without repeating redacted text). A paragraph may take several marks. Never add a duplicate visual `box` or `ellipse` around an already-marked paragraph.'
        : '';
    return [hybrid, lead(run), ...(ocr ? [ocr] : []), VISUAL_MARKS_RULE].join(' ');
  },
};

/**
 * The hidden instruction of a run on a screenshot (`run`) with output `action`, for `turn`.
 * Outputs that land on the screenshot use `mark_screenshot` (`annotate` also allows 0-tool plain
 * Markdown answers for pure Q&A); other outputs stay on the card or clipboard beside the open capture.
 */
export function screenshotTextInstruction(
  action: CommandOutputAction,
  run: CommandScreenshotText,
  verbatim: string | null,
  turn: ScreenshotTextTurn,
): string {
  const head = layout(run.paragraphs, turn);
  // A replacement's scope rule refers to its items; the others' format refers to their scope.
  if (action === 'replaceSelection')
    return [head, FORMATS[action](run), scope(run, action)].join(' ');
  if (landsOnScreenshot(action)) return [head, scope(run, action), FORMATS[action](run)].join(' ');
  const parts = [
    head,
    ...(run.paragraphs > 0
      ? [
          'The `[<id>]` / `[<id> @ x1,y1,x2,y2]` header lines only identify where each recognized paragraph starts and its coordinates: never repeat or mention them, and answer about the text itself.',
        ]
      : []),
    "Your reply is delivered only as text beside the screenshot (which stays open right next to this card — never tell the user to retake the screenshot) and cannot edit image pixels, redact regions, or draw canvas marks in this output mode; if the user asks to mask/redact or mark up the screenshot, provide what helps in text and briefly note they can switch 'When done' ('回答完成后') to 'Mark up the screenshot' ('标注在截图上') or use the capture toolbar's Mosaic ('马赛克') and markup tools.",
    scope(run, action),
  ];
  return [...parts, ...(verbatim ? [verbatim] : [])].join(' ');
}
