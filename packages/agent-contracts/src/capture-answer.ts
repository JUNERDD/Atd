import { Type, type Static } from 'typebox';
import { CommandOutputActionSchema, type CommandOutputAction } from './command-output.js';
import { MAX_SCREENSHOT_TEXT_PARAGRAPHS, type CaptureMarkTool } from './capture-tool.js';

/**
 * The contract of a command or Ask run on text recognized in a screenshot (the `screenshotText`
 * place). The app hands the command the picked paragraphs as its selection (`formatCaptureSelection`),
 * each block headed by `[<id>]` or `[<id> @ x1,y1,x2,y2]`. Outputs that land on the screenshot
 * (`landsOnScreenshot`) use the `mark_screenshot` tool (defined in `capture-tool.ts`), which
 * `parseCaptureAnswer` and `extractCaptureProgress` decode back into `CaptureAnswer`.
 */

/**
 * `CommandRunRequest.screenshotText`: the run reads text recognized in a screenshot, which its
 * selection holds in blocks (`formatCaptureSelection`). `scope` says whether the person picked
 * these `paragraphs` (`picked`) or picked none, so the run reads all the text (`all`).
 */
export const CommandScreenshotTextSchema = Type.Object(
  {
    scope: Type.Union([Type.Literal('picked'), Type.Literal('all')]),
    paragraphs: Type.Integer({ minimum: 0, maximum: MAX_SCREENSHOT_TEXT_PARAGRAPHS }),
  },
  { additionalProperties: false },
);
export type CommandScreenshotText = Static<typeof CommandScreenshotTextSchema>;

/**
 * `SubmitTaskRequest.screenshotText`: configures how an answer on screenshot text is formatted and
 * delivered on `POST /v1/tasks`:
 * - A free-form Ask on screenshot text (a new task, or a Regenerate repeat with `turn: 'run'`)
 *   carries `[<id>]` / `[<id> @ x1,y1,x2,y2]` blocks in `input.selection`, so the service places
 *   the `run` instruction and selection in hidden `RunSnapshot.instructions` while keeping
 *   `input.text` clean.
 * - An adjustment follow-up on a screenshot-text run (`turn: 'followUp'` or omitted on an
 *   existing task) tells the follow-up the same answer mode (`followUp`, or `reread` when the user
 *   picked other text and `input.selection` is non-empty).
 */
export const ScreenshotTextFollowUpSchema = Type.Object(
  {
    ...CommandScreenshotTextSchema.properties,
    output: CommandOutputActionSchema,
    turn: Type.Optional(Type.Union([Type.Literal('run'), Type.Literal('followUp')])),
  },
  { additionalProperties: false },
);
export type ScreenshotTextFollowUp = Static<typeof ScreenshotTextFollowUpSchema>;

/** Normalized 0..1000 integer point from top-left (0,0) to bottom-right (1000,1000). */
export interface CapturePoint {
  x: number;
  y: number;
}

/** Normalized 0..1000 integer coordinates (`x1,y1`..`x2,y2`, or `from` -> `to` for arrows/steps). */
export interface CaptureBounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** One recognized paragraph a run reads: its id, text, and optional 0..1000 screenshot bounds. */
export interface CaptureParagraph {
  id: string;
  text: string;
  bounds?: CaptureBounds;
}

/** The outputs whose answer lands on the screenshot itself, via `mark_screenshot`. */
export const CaptureAnswerActionSchema = Type.Union([
  Type.Literal('replaceSelection'),
  Type.Literal('insertAfterSelection'),
  Type.Literal('annotate'),
]);
export type CaptureAnswerAction = Static<typeof CaptureAnswerActionSchema>;

/**
 * Whether a run on screenshot text with output `action` changes the screenshot: replacing the
 * paragraphs (`replaceSelection`), or marking them with numbered steps (`insertAfterSelection`) or
 * with highlights, steps, mosaics, and visual shapes (`annotate`). Every other answer is an
 * ordinary one, which shows on the result card beside the screenshot.
 */
export function landsOnScreenshot(action: CommandOutputAction): action is CaptureAnswerAction {
  return (
    action === 'replaceSelection' || action === 'insertAfterSelection' || action === 'annotate'
  );
}

/**
 * One piece of an answer that lands on the screenshot: either on recognized paragraph `paragraph`
 * (`replace`, `step`, `highlight` or `mosaic`, optionally scoped to `phrase`) or on normalized
 * `0..1000` visual coordinates (`point` or `coords`), with `text` as its replacement or note.
 */
export interface CaptureAnswerItem {
  tool: CaptureMarkTool;
  paragraph?: string;
  phrase?: string;
  point?: CapturePoint;
  coords?: CaptureBounds;
  text: string;
}
export type CaptureMark = CaptureAnswerItem;

/** An answer read back: `lead`, an overall note, then its pieces in order. */
export interface CaptureAnswer {
  lead: string;
  items: CaptureAnswerItem[];
}

const SELECTION_HEADER = /^\[([A-Za-z0-9_-]+)(?:\s*@\s*(\d+),(\d+),(\d+),(\d+))?\]$/;

/** Header line of a recognized screenshot paragraph, with optional `0..1000` spatial bounds. */
export function formatCaptureHeader(p: Pick<CaptureParagraph, 'id' | 'bounds'>): string {
  return p.bounds
    ? `[${p.id} @ ${p.bounds.x1},${p.bounds.y1},${p.bounds.x2},${p.bounds.y2}]`
    : `[${p.id}]`;
}

/** The selection a run on screenshot text reads: each paragraph after its header line. */
export function formatCaptureSelection(paragraphs: readonly CaptureParagraph[]): string {
  return paragraphs.map((p) => `${formatCaptureHeader(p)}\n${p.text}`).join('\n\n');
}

/** Parses `[<id>]` or `[<id> @ x1,y1,x2,y2]` selection blocks back into `CaptureParagraph[]`. */
export function parseCaptureSelection(text: string): CaptureParagraph[] {
  const result: CaptureParagraph[] = [];
  let current: { id: string; bounds?: CaptureBounds; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    while (current.lines.length && current.lines.at(-1) === '') current.lines.pop();
    result.push({
      id: current.id,
      text: current.lines.join('\n'),
      ...(current.bounds ? { bounds: current.bounds } : {}),
    });
  };
  for (const line of text.split(/\r?\n/)) {
    const match = SELECTION_HEADER.exec(line);
    if (match) {
      flush();
      const id = match[1] ?? '';
      const hasBounds = match[2] !== undefined;
      current = {
        id,
        ...(hasBounds
          ? {
              bounds: {
                x1: Number(match[2]),
                y1: Number(match[3]),
                x2: Number(match[4]),
                y2: Number(match[5]),
              },
            }
          : {}),
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return result;
}

export * from './capture-tool.js';
