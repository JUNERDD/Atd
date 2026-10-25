import {
  COMPUTER_MAX_DOWNLOADS,
  COMPUTER_MAX_ELEMENTS,
  COMPUTER_MAX_UPLOAD_FILES,
  COMPUTER_SCREENSHOT_MAX_BASE64,
  COMPUTER_TEXT_MAX_LENGTH,
  COMPUTER_URL_MAX_LENGTH,
  COMPUTER_WAIT_MAX_MS,
} from '@atd/agent-contracts';
import * as z from 'zod';

/**
 * The worker's MCP tool schemas: the Swift adapter codes against these shapes. Inputs are strict
 * (unknown keys refused); there is no tool argument that names a socket, a port, a window title
 * or a script. File paths appear only where the host names them inside its data directory:
 * `downloadDir` (`<dataDir>/computer/downloads/<runId>`) and upload `paths` (files inside
 * `ATD_UPLOAD_ROOT`, `<dataDir>/resources`); the worker checks both again.
 *
 * Every page tool result carries `ok`, `dispatched` (whether anything that can change the page
 * was sent: `false` means it certainly was not), and, when the call got far enough to read them,
 * the page's `navigationGeneration` and `observationVersion` after the call. A refusal or failure
 * sets `ok: false`, `error` and the MCP `isError` flag. A call the SDK rejects for invalid
 * arguments returns `isError` without structured content; nothing was read or sent then.
 */

export const PageId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const ElementRef = z.string().regex(/^\d{1,9}\.\d{1,15}$/);
export const OperationId = z.string().min(1).max(128);
const ObservationVersion = z.number().int().min(1);
export const HttpUrl = z
  .string()
  .min(1)
  .max(COMPUTER_URL_MAX_LENGTH)
  .regex(/^https?:\/\//);

const ErrorCode = z.enum([
  'staleObservation',
  'notFound',
  'ambiguous',
  'targetChanged',
  'unsupported',
  'timeout',
  'cancelled',
  'engineFailed',
]);

const Evidence = z.object({
  kind: z.enum(['value', 'text', 'url']),
  summary: z.string().max(500),
});

/** Fields every page tool result may carry. */
export const common = {
  ok: z.boolean(),
  dispatched: z.boolean(),
  pageId: z.string().optional(),
  navigationGeneration: z.number().int().min(1).optional(),
  observationVersion: z.number().int().min(1).optional(),
  error: z.object({ code: ErrorCode, message: z.string().max(2000) }).optional(),
  evidence: z.array(Evidence).max(20).optional(),
  /**
   * Downloads saved into the call's `downloadDir` that no earlier reply reported, as
   * `ActionResult.downloads` entries (the worker gives no `mime`).
   */
  downloads: z
    .array(z.object({ name: z.string(), path: z.string(), bytes: z.number().int().min(0) }))
    .max(COMPUTER_MAX_DOWNLOADS)
    .optional(),
};

/** An http(s) origin of the binding: frames outside the call's origins are never read or driven. */
export const Origin = z.string().regex(/^https?:\/\/[^/?#\s]+$/);

/**
 * Fields every page tool takes. `allowedOrigins`: the binding's origins (absent: the main
 * frame's own origin only). `downloadDir`: the run directory (`<dataDir>/computer/downloads/<runId>`) this
 * page's downloads, and those of pages it opens, go to from this call on; without one a download
 * of the page is cancelled.
 */
const withOperation = {
  operationId: OperationId.optional(),
  allowedOrigins: z.array(Origin).max(32).optional(),
  downloadDir: z.string().min(2).max(4096).regex(/^\//).optional(),
};

export const listPagesInput = {};
export const listPagesOutput = {
  ...common,
  /** `openerId`: the page target that opened this one, when Chrome reports it. */
  pages: z
    .array(
      z.object({
        pageId: z.string(),
        url: z.string(),
        title: z.string(),
        openerId: z.string().optional(),
      }),
    )
    .optional(),
};

export const observeInput = { pageId: PageId, screenshot: z.boolean(), ...withOperation };
export const observeOutput = {
  ...common,
  url: z.string().optional(),
  title: z.string().optional(),
  elements: z
    .array(
      z.object({
        ref: z.string(),
        role: z.string(),
        name: z.string().max(200).optional(),
        value: z.string().max(200).optional(),
        enabled: z.boolean(),
        /** Set (true) on the element that has the keyboard focus, when it is listed. */
        focused: z.boolean().optional(),
      }),
    )
    .max(COMPUTER_MAX_ELEMENTS)
    .optional(),
  /** More elements than `COMPUTER_MAX_ELEMENTS` were on the page; the rest are left out. */
  truncated: z.boolean().optional(),
  /** The page text at observation time, for a later `newText` condition. */
  baselineId: z.string().optional(),
  screenshot: z
    .object({
      mime: z.literal('image/png'),
      base64: z.string().max(COMPUTER_SCREENSHOT_MAX_BASE64),
    })
    .optional(),
  /** Why a requested screenshot is missing (`tooLarge` or `failed`). */
  screenshotOmitted: z.enum(['tooLarge', 'failed']).optional(),
};

/** An empty `text` empties the field: the `clear` step. */
export const fillInput = {
  pageId: PageId,
  ref: ElementRef,
  text: z.string().max(COMPUTER_TEXT_MAX_LENGTH),
  feedback: z
    .strictObject({
      chunks: z
        .array(
          z.strictObject({
            end: z.number().int().min(1).max(COMPUTER_TEXT_MAX_LENGTH),
            dueMs: z.number().int().min(0).max(1200),
          }),
        )
        .max(61),
      highlight: z.boolean(),
      reduceMotion: z.boolean(),
      increaseContrast: z.boolean(),
    })
    .optional(),
  observationVersion: ObservationVersion,
  ...withOperation,
};
export const fillOutput = { ...common, verified: z.boolean().optional() };

export const pressInput = {
  pageId: PageId,
  ref: ElementRef,
  observationVersion: ObservationVersion,
  requireEnabled: z.literal(true),
  ...withOperation,
};
/** `baselineId`: the page text just before the click, for a following `newText` wait. */
export const pressOutput = { ...common, baselineId: z.string().optional() };

export const scrollInput = {
  pageId: PageId,
  ref: ElementRef.optional(),
  /** Required with `ref`: the observation the ref came from. */
  observationVersion: ObservationVersion.optional(),
  direction: z.enum(['up', 'down', 'left', 'right']),
  amount: z.number().int().min(1).max(20),
  ...withOperation,
};
export const scrollOutput = { ...common };

const Condition = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('enabled'), ref: ElementRef }),
  z.strictObject({
    kind: z.literal('valueEquals'),
    ref: ElementRef,
    text: z.string().max(COMPUTER_TEXT_MAX_LENGTH),
  }),
  z.strictObject({ kind: z.literal('textAppears'), text: z.string().min(1).max(500) }),
  z.strictObject({ kind: z.literal('urlMatches'), pattern: HttpUrl }),
  z.strictObject({
    kind: z.literal('newText'),
    baselineId: z.string().min(1).max(64),
    ref: ElementRef.optional(),
    pattern: z.string().min(1).max(200).optional(),
  }),
]);
export type WaitCondition = z.infer<typeof Condition>;

export const waitInput = {
  pageId: PageId,
  condition: Condition,
  timeoutMs: z.number().int().min(1).max(COMPUTER_WAIT_MAX_MS),
  ...withOperation,
};
export const waitOutput = { ...common, satisfied: z.boolean().optional() };

export const navigateInput = { pageId: PageId, url: HttpUrl, ...withOperation };
export const navigateOutput = { ...common, url: z.string().optional() };

export const cancelInput = { operationId: OperationId };
export const cancelOutput = { ...common, aborted: z.number().int().min(0).optional() };

/**
 * A Playwright key chord of the host's closed key vocabulary: up to four modifiers, then one key
 * (`Enter`, `Control+Shift+ArrowUp`, `Meta+KeyA`, `a`). Pressed on the focus or on `ref`.
 */
const KeyChord = z
  .string()
  .max(64)
  .regex(
    /^(?:(?:Control|Shift|Alt|Meta|ControlOrMeta)\+){0,4}(?:Enter|Tab|Escape|Arrow(?:Up|Down|Left|Right)|Space|Backspace|Delete|Home|End|PageUp|PageDown|F(?:[1-9]|1[0-2])|Key[A-Z]|Digit[0-9]|[A-Za-z0-9])$/,
  );
export const keyInput = {
  pageId: PageId,
  ref: ElementRef.optional(),
  /** Required with `ref`: the observation the ref came from. */
  observationVersion: ObservationVersion.optional(),
  keys: KeyChord,
  ...withOperation,
};
export const keyOutput = { ...common };

/** `label`: the visible label of the option to choose in a select element. */
export const selectInput = {
  pageId: PageId,
  ref: ElementRef,
  observationVersion: ObservationVersion,
  label: z.string().min(1).max(200),
  ...withOperation,
};
export const selectOutput = { ...common, verified: z.boolean().optional() };

/** `paths`: absolute files inside `ATD_UPLOAD_ROOT`, set on the file input in this order. */
export const uploadInput = {
  pageId: PageId,
  ref: ElementRef,
  observationVersion: ObservationVersion,
  paths: z.array(z.string().min(2).max(4096).regex(/^\//)).min(1).max(COMPUTER_MAX_UPLOAD_FILES),
  ...withOperation,
};
export const uploadOutput = { ...common };

/** The downloads saved into (or failed for) one run directory, oldest first. */
export const downloadsInput = { downloadDir: z.string().min(2).max(4096).regex(/^\//) };
export const downloadsOutput = {
  ...common,
  downloads: z
    .array(
      z.object({
        id: z.string(),
        pageId: z.string(),
        name: z.string(),
        state: z.enum(['inProgress', 'completed', 'failed']),
        path: z.string().optional(),
        bytes: z.number().int().min(0).optional(),
      }),
    )
    .optional(),
};

export const capabilitiesOutput = {
  worker: z.string(),
  playwrightCore: z.string(),
  tools: z.array(z.string()),
};
