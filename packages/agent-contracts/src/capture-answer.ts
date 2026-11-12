import { Type, type Static } from 'typebox';
import { CommandOutputActionSchema, type CommandOutputAction } from './command-output.js';

/**
 * The grammar of a command run on text recognized in a screenshot (the `screenshotText` place).
 * The app hands the command the picked paragraphs as its selection, each block a marker line
 * `@@<id>` followed by the paragraph's text (`formatCaptureSelection`). The run's hidden output
 * instruction asks for an answer in blocks with the same markers wherever the answer lands on the
 * screenshot (`landsOnScreenshot`), and the app reads them back as they stream
 * (`parseCaptureAnswer`), so the service's instruction and the page's parser share this one
 * definition.
 */

/** What starts a block in the selection and in the answer: this marker, then a paragraph's id. */
export const CAPTURE_BLOCK_MARKER = '@@';

/** Paragraphs one run on screenshot text reads at most: a long screenshot's whole text fits. */
export const MAX_SCREENSHOT_TEXT_PARAGRAPHS = 4000;

/**
 * `CommandRunRequest.screenshotText`: the run reads text recognized in a screenshot, which its
 * selection holds in blocks (`formatCaptureSelection`). `scope` says whether the person picked
 * these `paragraphs` (`picked`) or picked none, so the run reads all the text (`all`). The service
 * then accepts the screenshot and its screen context as attached files whatever the command's
 * input accepts, and tells the model how its answer is read (the capture answer grammar).
 */
export const CommandScreenshotTextSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal('picked'), Type.Literal('all')]),
    paragraphs: Type.Integer({ minimum: 1, maximum: MAX_SCREENSHOT_TEXT_PARAGRAPHS }),
  },
  { additionalProperties: false },
);
export type CommandScreenshotText = Static<typeof CommandScreenshotTextSchema>;

/**
 * `SubmitTaskRequest.screenshotText`: a follow-up that makes a new version of the answer of a run
 * on screenshot text (an adjustment on its review card) carries that run's `scope` and
 * `paragraphs` and where its answer goes (`output`), so the service tells the follow-up the same
 * answer format the run was told. When the person picked other text since the run last read it,
 * the follow-up carries that text as its input's `selection` (in the blocks
 * `formatCaptureSelection` writes) and the screenshot as it shows now in its files, and `scope`
 * and `paragraphs` describe that text, which the service tells the follow-up to answer for. Only a
 * follow-up on an existing task carries it.
 */
export const ScreenshotTextFollowUpSchema = Type.Object(
  { ...CommandScreenshotTextSchema.properties, output: CommandOutputActionSchema },
  { additionalProperties: false },
);
export type ScreenshotTextFollowUp = Static<typeof ScreenshotTextFollowUpSchema>;

/** One recognized paragraph a run reads: the id the shell minted for it and its text. */
export interface CaptureParagraph {
  id: string;
  text: string;
}

/** The outputs whose answer lands on the screenshot itself, so it is written in blocks. */
export type CaptureAnswerAction = Extract<
  CommandOutputAction,
  'replaceSelection' | 'insertAfterSelection' | 'annotate'
>;

/**
 * Whether a run on screenshot text with output `action` changes the screenshot: replacing the
 * paragraphs (`replaceSelection`), or marking them with numbered steps (`insertAfterSelection`) or
 * with highlights and steps (`annotate`). Every other answer is an ordinary one, which shows on the
 * result card beside the screenshot.
 */
export function landsOnScreenshot(action: CommandOutputAction): action is CaptureAnswerAction {
  return (
    action === 'replaceSelection' || action === 'insertAfterSelection' || action === 'annotate'
  );
}

/**
 * One piece of an answer that lands on the screenshot: `replace` the text that replaces paragraph
 * `paragraph`; `step` a numbered step on it, with `text` as its numbered note; `highlight` a
 * highlighter mark over `phrase` (an exact part of the paragraph's text; absent: the whole
 * paragraph), with `text` as an optional note.
 */
export interface CaptureAnswerItem {
  paragraph: string;
  tool: 'replace' | 'step' | 'highlight';
  phrase?: string;
  text: string;
}

/** An answer read back: `lead`, the text before its first block, then its pieces in order. */
export interface CaptureAnswer {
  lead: string;
  items: CaptureAnswerItem[];
}

/** The selection a run on screenshot text reads: each paragraph after its marker line. */
export function formatCaptureSelection(paragraphs: readonly CaptureParagraph[]): string {
  return paragraphs.map(({ id, text }) => `${CAPTURE_BLOCK_MARKER}${id}\n${text}`).join('\n\n');
}

/** A block's marker line: the marker, an id, and the rest of the line (a tool and a phrase). */
const HEADER = /^[ \t]*@@([A-Za-z0-9_-]+)(.*)$/;
/** What may follow an `annotate` marker: a tool, a «phrase», then the note's first words. */
const ANNOTATION = /^\s*(?:(highlight|step)(?![\w-]))?\s*(?:«([^»]*)»)?\s*(.*)$/i;
/** A code fence line, which the instruction forbids but a model may still wrap the answer in. */
const FENCE = /^\s*```[\w-]*\s*$/;

interface Block {
  id: string;
  /** The marker line after the id. */
  rest: string;
  lines: string[];
}

/** `lines` without blank lines around them, joined; `first` (from the marker line) leads. */
function blockText(first: string, lines: readonly string[]): string {
  const all = first.trim() ? [first.trim(), ...lines] : [...lines];
  while (all.length && !all[0]?.trim()) all.shift();
  while (all.length && !all.at(-1)?.trim()) all.pop();
  return all.join('\n').trimEnd();
}

/** `source` as a pattern that ignores how the whitespace between its words is written. */
function looseWhitespace(source: string): RegExp {
  const escaped = source
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('\\s+'));
}

/**
 * Where `phrase` is in the paragraph's `text`: the phrase itself, or the passage of `text` it
 * names when only its whitespace differs (recognized lines wrap where the model's copy does not).
 * Undefined when the paragraph has no such passage, so the mark covers the whole paragraph.
 */
function located(text: string, phrase: string | undefined): string | undefined {
  if (!phrase?.trim()) return undefined;
  if (text.includes(phrase)) return phrase;
  return looseWhitespace(phrase).exec(text)?.[0];
}

/** The piece a block makes under `action`, or null when it says nothing usable. */
function itemOf(
  action: CaptureAnswerAction,
  block: Block,
  source: string,
): CaptureAnswerItem | null {
  if (action !== 'annotate') {
    const text = blockText(block.rest, block.lines);
    // An empty replacement would erase the paragraph, and an empty step has nothing to number.
    if (!text) return null;
    return { paragraph: block.id, tool: action === 'replaceSelection' ? 'replace' : 'step', text };
  }
  const [, word, phrase, first = ''] = ANNOTATION.exec(block.rest) ?? [];
  const text = blockText(first, block.lines);
  if (word?.toLowerCase() === 'step')
    return text ? { paragraph: block.id, tool: 'step', text } : null;
  const exact = located(source, phrase);
  const item: CaptureAnswerItem = { paragraph: block.id, tool: 'highlight', text };
  return exact === undefined ? item : { ...item, phrase: exact };
}

/**
 * Reads an answer to a run on screenshot text whose output is `action`, as far as `text` goes:
 * the lines before its first marker line are the `lead`, and each block (a marker line `@@<id>`
 * and the lines up to the next one) becomes a piece on paragraph `<id>`: under `replaceSelection`
 * its replacement, under `insertAfterSelection` a numbered step with the block's note, under
 * `annotate` the mark its marker line names (`highlight`, the default, optionally over a
 * `«phrase»` of the paragraph, or `step`) with its note. While the answer still streams
 * (`final` false) its last block may be unfinished, so it is left out, as is a lead line that may
 * still become a marker; once `final`, every block counts. Blocks on ids no paragraph has are
 * dropped, as are empty replacements and steps, and a paragraph's second replacement. A final
 * answer to a single paragraph written without any marker (a model that forgot them) is that
 * paragraph's replacement or step. A code fence around the whole answer is not part of it.
 */
export function parseCaptureAnswer(
  text: string,
  options: { action: CaptureAnswerAction; paragraphs: readonly CaptureParagraph[]; final: boolean },
): CaptureAnswer {
  const { action, paragraphs, final } = options;
  const lines = text.split(/\r?\n/);
  if (lines.length && FENCE.test(lines.find((line) => line.trim()) ?? '')) {
    const start = lines.findIndex((line) => line.trim());
    lines.splice(start, 1);
  }
  if (final && lines.length && FENCE.test(lines.findLast((line) => line.trim()) ?? '')) {
    const end = lines.findLastIndex((line) => line.trim());
    lines.splice(end, 1);
  }
  const lead: string[] = [];
  const blocks: Block[] = [];
  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) blocks.push({ id: header[1] ?? '', rest: header[2] ?? '', lines: [] });
    else (blocks.at(-1)?.lines ?? lead).push(line);
  }
  if (!final) {
    if (blocks.length) blocks.pop();
    else if (lead.at(-1)?.trimStart().startsWith('@')) lead.pop();
  }
  const sources = new Map(paragraphs.map(({ id, text: source }) => [id, source]));
  const replaced = new Set<string>();
  const items: CaptureAnswerItem[] = [];
  for (const block of blocks) {
    const source = sources.get(block.id);
    const item = source === undefined ? null : itemOf(action, block, source);
    if (!item || (item.tool === 'replace' && replaced.has(item.paragraph))) continue;
    if (item.tool === 'replace') replaced.add(item.paragraph);
    items.push(item);
  }
  const [only] = paragraphs;
  const intro = blockText('', lead);
  if (final && !blocks.length && paragraphs.length === 1 && only && intro && action !== 'annotate')
    return {
      lead: '',
      items: [
        {
          paragraph: only.id,
          tool: action === 'replaceSelection' ? 'replace' : 'step',
          text: intro,
        },
      ],
    };
  return { lead: intro, items };
}
