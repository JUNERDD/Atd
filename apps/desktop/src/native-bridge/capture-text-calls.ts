/**
 * Commands run on text recognized in a screenshot (`NativeCaptureTextCalls`, part of
 * `NativeCalls` in `calls.ts`, and `NativeCaptureTextEvents`, part of `NativeEvents` in
 * `contract.ts`): the capture editor and the long screenshot's full-screen preview stay open
 * while a command placed on `screenshotText` runs on the paragraphs the person picked, the panel's
 * page runs it as a task the panel does not show, and the shell shows its progress and answer on
 * the surface's own result card. Where the answer lands follows the run's output: a
 * `replaceSelection` answer replaces each paragraph on the image, an `insertAfterSelection` or
 * `annotate` answer becomes annotations the shell draws with its own tools (numbered step
 * markers, highlighter), and every other answer stays on the result card. Loaded by the export
 * script with Node's type stripping, so it imports nothing but TypeBox and its sibling contract
 * files (by their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { CommandArgumentsSchema, CommandOutputActionSchema } from './command-options.ts';
import { CommandReviewSchema, MAX_REVIEW_VERSIONS, ReviewAdjustSchema } from './command-review.ts';
import { NativeFileRefSchema } from './file-calls.ts';
import { Empty, MAX_CAPTURE_LENGTH, MAX_NATIVE_TEXT_LENGTH } from './primitives.ts';

/** An id the shell mints for one run. */
const RunId = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });
/** A paragraph's id within one run, minted by the shell (short, so the model can echo it). */
const ParagraphId = Type.String({ minLength: 1, maxLength: 16, pattern: '^[a-zA-Z0-9_-]+$' });
/** Paragraphs one run reads at most: a long screenshot's whole text fits. */
export const MAX_CAPTURE_TEXT_PARAGRAPHS = 4000;

/** Normalized 0..1000 integer coordinate from top-left (0,0) to bottom-right (1000,1000). */
const NormalizedCoord = Type.Integer({ minimum: 0, maximum: 1000 });
const CapturePointSchema = Type.Object(
  { x: NormalizedCoord, y: NormalizedCoord },
  { additionalProperties: false },
);
const CaptureBoundsSchema = Type.Object(
  { x1: NormalizedCoord, y1: NormalizedCoord, x2: NormalizedCoord, y2: NormalizedCoord },
  { additionalProperties: false },
);

/**
 * One paragraph the run reads: recognized lines the shell grouped, with any text a mosaic touches
 * already left out (`ScreenContext.unredacted`), and optional normalized 0..1000 `bounds`.
 */
const CaptureParagraphSchema = Type.Object(
  {
    id: ParagraphId,
    text: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
    bounds: Type.Optional(CaptureBoundsSchema),
  },
  { additionalProperties: false },
);

/** Whether the person picked the paragraphs a run reads (`picked`) or it reads all the text. */
const CaptureTextScopeSchema = Type.Union([Type.Literal('picked'), Type.Literal('all')]);
/** The recognized paragraphs a run reads (empty on a pure-image screenshot), in reading order. */
const CaptureParagraphsSchema = Type.Array(CaptureParagraphSchema, {
  maxItems: MAX_CAPTURE_TEXT_PARAGRAPHS,
});
/** The screenshot as it shows (with its mosaics) and its screen context, as the shell imported them. */
const CaptureFilesSchema = Type.Array(NativeFileRefSchema, { maxItems: 4 });

/**
 * One piece of a structured answer, in the answer's order:
 * - On recognized paragraph `paragraph`: `replace` replaces its text; `step` places a numbered step
 *   with `text` as its note; `highlight` marks `phrase` (or the whole paragraph) with optional
 *   `text`; `mosaic` redacts `phrase` (or the whole paragraph) with optional `text`.
 * - On normalized `0..1000` visual coordinates: `box`, `ellipse`, `spotlight` and `mosaic` mark
 *   `coords` (`x1,y1`..`x2,y2`); `arrow` points from tail `x1,y1` to arrowhead `x2,y2` in `coords`;
 *   `step` places a numbered badge at `point` (`x,y`) or badge `x1,y1` pointing to `x2,y2` in
 *   `coords`, with `text` as its note.
 */
const CaptureResultItemSchema = Type.Object(
  {
    tool: Type.Union([
      Type.Literal('replace'),
      Type.Literal('step'),
      Type.Literal('highlight'),
      Type.Literal('box'),
      Type.Literal('ellipse'),
      Type.Literal('arrow'),
      Type.Literal('spotlight'),
      Type.Literal('mosaic'),
    ]),
    paragraph: Type.Optional(ParagraphId),
    phrase: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH })),
    point: Type.Optional(CapturePointSchema),
    coords: Type.Optional(CaptureBoundsSchema),
    text: Type.String({ maxLength: MAX_CAPTURE_LENGTH }),
  },
  { additionalProperties: false },
);

/**
 * An answer that lands on the screenshot, parsed so far: `lead`, any text before the first piece
 * (an overall meaning), and `items`, every piece completed so far, in the answer's order.
 */
export const CaptureResultSchema = Type.Object(
  {
    lead: Type.String({ maxLength: MAX_CAPTURE_LENGTH }),
    items: Type.Array(CaptureResultItemSchema, { maxItems: MAX_CAPTURE_TEXT_PARAGRAPHS }),
  },
  { additionalProperties: false },
);

export const NativeCaptureTextCalls = {
  /**
   * The run `runId` as it stands, sent as it grows: `thinking` until its first text, `streaming`
   * with the answer so far, then once `done`, `stopped` (`captureText.action`'s `stop`, or the run
   * was stopped elsewhere) or `failed`, each with what it produced (empty when nothing). Each
   * update replaces the previous one.
   *
   * `output` is where this run's answer goes (the run's `arguments.output`, else the command's
   * saved output) and `awaitsApply` whether its answer waits for the person to apply it before it
   * lands (the output's `review`, on an output that lands on the screenshot); both are the same in
   * every update. For `replaceSelection`, `insertAfterSelection` and `annotate`, `result` holds
   * the answer parsed so far: `lead`, any text before the first piece (an overall meaning), and
   * `items`, every piece completed so far (the one still being written is left out until it
   * ends or the run settles), which the shell applies as they arrive (or previews, while the
   * answer awaits applying). For the other outputs `result` is absent and `text` is the answer to
   * show; under `copy` the shell puts the final `text` on the clipboard itself once `done`.
   *
   * `review` is the run's versions: present once its first answer became version 1 (any output),
   * and while the first version of an answer that awaits applying is made. From then on every
   * update's `text` and `result` are the version shown, whole, which is what the shell puts on the
   * image (or previews, or shows on the card), and `state` says how the newest attempt stands:
   * `thinking` or `streaming` while another version is made (`review.pending`), `failed` once
   * when one made no version, and `done` otherwise. A version stopped once its answer showed
   * something becomes the newest version with what it kept, as the run's own first answer does.
   *
   * `draft` is the version being made as its answer grows, once its answer began (`streaming`
   * with `review.pending`): `text` its answer so far and, for an output that lands on the
   * screenshot, `result` its pieces so far as `result` holds them. The shell shows it as the
   * card's newest page while the person may page back to the versions made; nothing of it lands
   * on the image, previews there or is copied until it becomes a version. Absent otherwise.
   *
   * Only the panel's page sends it; an update for a run the shell no longer shows is ignored.
   */
  'captureText.progress': {
    params: Type.Object(
      {
        runId: RunId,
        state: Type.Union([
          Type.Literal('thinking'),
          Type.Literal('streaming'),
          Type.Literal('done'),
          Type.Literal('stopped'),
          Type.Literal('failed'),
        ]),
        output: CommandOutputActionSchema,
        text: Type.String({ maxLength: MAX_NATIVE_TEXT_LENGTH }),
        result: Type.Optional(CaptureResultSchema),
        awaitsApply: Type.Boolean(),
        review: Type.Optional(CommandReviewSchema),
        draft: Type.Optional(
          Type.Object(
            {
              text: Type.String({ maxLength: MAX_NATIVE_TEXT_LENGTH }),
              result: Type.Optional(CaptureResultSchema),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};

export const NativeCaptureTextEvents = {
  /**
   * The person ran command `commandId` (placed on `screenshotText`) or asked a free-form `question`
   * on text in the screenshot shown on `surface`: the capture editor (`capture`) or a long
   * screenshot's full-screen preview (`longScreenshot`). `paragraphs` are what it reads, which the
   * page hands the command or question as its selection in the order given: reading order, except
   * that the full-screen preview puts the paragraphs in view first so their answers land first;
   * `scope` says whether the person picked them (`picked`) or picked none, so the run reads all
   * the text (`all`). `arguments` are the values picked in the command's options menu over the
   * remembered ones (absent: the remembered ones), its `output` where the answer goes for this
   * run (default `annotate` for a `question`). `files` are the screenshot as it shows (with its
   * mosaics) and its screen context, as the shell imported them, attached to the run whatever the
   * command's input accepts. The page runs it as a new task the panel does not show and answers
   * with `captureText.progress`. Sent to the panel only.
   */
  'captureText.run': Type.Object(
    {
      runId: RunId,
      surface: Type.Union([Type.Literal('capture'), Type.Literal('longScreenshot')]),
      commandId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
      question: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH })),
      arguments: Type.Optional(CommandArgumentsSchema),
      scope: CaptureTextScopeSchema,
      paragraphs: CaptureParagraphsSchema,
      files: CaptureFilesSchema,
    },
    { additionalProperties: false },
  ),
  /**
   * The person acted on the result card of run `runId`: `stop` the run (it keeps what it
   * produced); `open` it in Atd (the panel shows its task and the surface goes away); once the run
   * has versions, `regenerate`, `adjust` (with `adjust`, what the card staged), `version` (with
   * `version`, the one to show), `again` (the person ran the run's command again on the same
   * text, with `arguments` the values its options menu picked: a version with those values, or
   * the shown version's values made again when they change nothing), or `stop` the version being
   * made (keeping what it produced, as `captureText.progress` says); `version` may come while one
   * is made, which goes on meanwhile; `close` once the card and every result of the run went away
   * or the surface closed, so the page lets the run go. Sent to the panel only.
   *
   * A retry reads the person's selection as it is now: `regenerate` and `adjust` carry `reading`
   * when the paragraphs it holds are not the ones the run read last (the person moved or resized
   * the selection, changed the kept range or picked other paragraphs), and the version they make
   * and every one after it read those, as `captureText.run`'s fields say. A paragraph the run read
   * before keeps its id there and a new one takes an id the run has not used, so the versions made
   * before keep their pieces.
   */
  'captureText.action': Type.Object(
    {
      runId: RunId,
      action: Type.Union([
        Type.Literal('stop'),
        Type.Literal('open'),
        Type.Literal('regenerate'),
        Type.Literal('adjust'),
        Type.Literal('version'),
        Type.Literal('again'),
        Type.Literal('close'),
      ]),
      adjust: Type.Optional(ReviewAdjustSchema),
      arguments: Type.Optional(CommandArgumentsSchema),
      version: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_REVIEW_VERSIONS })),
      reading: Type.Optional(
        Type.Object(
          {
            scope: CaptureTextScopeSchema,
            paragraphs: CaptureParagraphsSchema,
            files: CaptureFilesSchema,
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
};
