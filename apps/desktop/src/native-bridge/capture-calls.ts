/**
 * The native bridge's capture overlay (`NativeCaptureCalls`, part of `NativeCalls` in `calls.ts`,
 * and `NativeCaptureEvents`, part of `NativeEvents` in `contract.ts`): taking and editing a
 * screenshot, what the screenshot toolbar offers, and the screenshot and record-screen shortcuts.
 * Loaded by the export script with Node's type stripping, so it imports nothing but TypeBox and
 * its sibling contract files (by their `.ts` names) and uses only erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { CommandArgumentsSchema, ShortcutCommandIntentSchema } from './command-options.ts';
import { NativeFileRefSchema } from './file-calls.ts';
import { Empty, MAX_CAPTURE_LENGTH } from './primitives.ts';
import { NativeWriteTargetSchema } from './text-calls.ts';

/** The capture overlay's two modes: a screenshot, or a recording of the screen. */
export const CaptureModeSchema = Type.Union([Type.Literal('screenshot'), Type.Literal('record')]);

/** The image a capture or an edit imported, with its screen context. */
const ShotFields = {
  ok: Type.Literal(true),
  file: NativeFileRefSchema,
  context: Type.Union([NativeFileRefSchema, Type.Null()]),
  capturedAt: Type.String({ maxLength: 64 }),
};

/**
 * Text picked in the screenshot when the capture ended on the toolbar: the picked paragraphs'
 * text in reading order, separated by blank lines, without any text a mosaic touches. A command
 * that reads `{{selection}}` gets it as its selection, besides the screenshot; an ask gets it as
 * the text it is about. Absent: nothing was picked.
 */
const PickedText = Type.Optional(Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }));

/**
 * What the person picked on the screenshot toolbar, which ended the capture: a command placed
 * there (`id`, with the values picked in its options over the remembered ones and, in `output`,
 * where its answer goes for this run, and what to do with it as `shortcut.command`'s `intent`
 * says, absent: `run`), or a question typed in its ask field (`question`); either with the text
 * picked in the screenshot (`selection`).
 */
const ScreenshotLaunchSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('command'),
      id: Type.String({ minLength: 1, maxLength: 128 }),
      arguments: Type.Optional(CommandArgumentsSchema),
      intent: Type.Optional(ShortcutCommandIntentSchema),
      selection: PickedText,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('ask'),
      question: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
      selection: PickedText,
    },
    { additionalProperties: false },
  ),
]);

/** A command a screenshot surface offers: its id and name. */
const ToolbarCommand = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const NativeCaptureCalls = {
  /**
   * Lets the user capture an area, a window or the screen on the native capture overlay (element
   * detection, annotation), with the panel out of the way, and imports the image through
   * `/v1/resources/import`. The panel's visibility is restored afterwards. `context` is a Markdown
   * attachment imported beside the image (app and window, the picked interface element,
   * recognised text), or null when there is nothing to say. `notPermitted`: Screen Recording is
   * not granted (Swift asks once per launch); `cancelled`: the user dismissed the capture. An
   * import the service refuses rejects with its message.
   *
   * Every caller chooses its purpose explicitly. `capture` opens the full screenshot/recording
   * session in `mode`, including the screenshot toolbar (`screenshotToolbar.set`): the composer,
   * global capture shortcuts and mini panel use it. `image` supplies a screenshot to an existing
   * command input or attachment destination; it cannot launch commands or switch to recording,
   * so `launch`, `target` and `recording` never answer. `launch`: the capture ended on the toolbar,
   * with a command or a question to run on the image. `target`: the text field focused in the app
   * in front before the capture, recorded only with a `launch`, which an answer typed at the
   * cursor goes into. `recording`: the user started a recording from the overlay, which the shell
   * now runs on its own; the page adds and shows nothing. `longScreenshot`: the user took a long
   * (scrolling) screenshot, which the shell shows on the island's result card; the page adds and
   * shows nothing.
   */
  'screenshot.capture': {
    params: Type.Union([
      Type.Object(
        { purpose: Type.Literal('capture'), mode: CaptureModeSchema },
        { additionalProperties: false },
      ),
      Type.Object({ purpose: Type.Literal('image') }, { additionalProperties: false }),
    ]),
    result: Type.Union([
      Type.Object(
        {
          ...ShotFields,
          launch: Type.Optional(ScreenshotLaunchSchema),
          target: Type.Optional(NativeWriteTargetSchema),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ok: Type.Literal(false),
          reason: Type.Union([
            Type.Literal('cancelled'),
            Type.Literal('notPermitted'),
            Type.Literal('recording'),
            Type.Literal('longScreenshot'),
          ]),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  /**
   * Opens an image attachment (`resourceId`, an image resource) on the capture overlay for more
   * annotation and cropping, and imports the result as a new resource; the original is left as it
   * is. A capture taken during this app run reopens with its annotations still editable; any other
   * image is annotated on top of its pixels. `context` is always null (the caller keeps any context
   * it had); `cancelled` leaves the attachment unchanged.
   */
  'screenshot.edit': {
    params: Type.Object(
      { resourceId: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }) },
      { additionalProperties: false },
    ),
    result: Type.Union([
      Type.Object(ShotFields, { additionalProperties: false }),
      Type.Object(
        {
          ok: Type.Literal(false),
          reason: Type.Union([Type.Literal('cancelled'), Type.Literal('notPermitted')]),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  /**
   * Replaces the commands the screenshot toolbar offers; the page pushes it whenever they change.
   * `commands`: the enabled commands placed on the screenshot toolbar whose input is a screenshot,
   * in command-list order; picking one ends the capture with a `launch` (`screenshot.capture`).
   * `textCommands`: the enabled commands placed on `screenshotText` that read the selection, in
   * command-list order, which the capture editor and the long screenshot's full-screen preview
   * offer on text picked in the screenshot; picking one keeps the surface open and runs it there
   * (`captureText.run`). Their options and where their answers go come from
   * `commandOptions.set`, as the selection toolbar's do.
   */
  'screenshotToolbar.set': {
    params: Type.Object(
      {
        commands: Type.Array(ToolbarCommand, { maxItems: 64 }),
        textCommands: Type.Array(ToolbarCommand, { maxItems: 64 }),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
};

export const NativeCaptureEvents = {
  /**
   * A global capture shortcut or the mini panel requested the full capture session in `mode`.
   * The panel opens it with purpose `capture`; attachment capacity is checked only when the
   * outcome is an image for the draft, so a full draft still permits questions and recording.
   */
  'shortcut.screenshot': Type.Object({ mode: CaptureModeSchema }, { additionalProperties: false }),
};
