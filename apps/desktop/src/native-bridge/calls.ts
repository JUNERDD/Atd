/**
 * Calls of the native bridge (`contract.ts`): the JS → Swift requests Swift answers, with the
 * schemas their params and results use; the file calls and their records live in `file-calls.ts`,
 * the window and app presence calls in `window-calls.ts`.
 * Like the rest of the contract, the export script loads this file with Node's type stripping, so
 * it imports nothing but TypeBox and its sibling contract files (by their `.ts` names) and uses only
 * erasable TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';
import { NativeFileCalls, NativeFileRefSchema } from './file-calls.ts';
import { NativeWindowCalls } from './window-calls.ts';
import { Empty, MAX_NATIVE_TEXT_LENGTH, Text } from './primitives.ts';

export {
  MAX_SAVE_PNG_BASE64_LENGTH,
  NativeFileRefSchema,
  NativeFolderRefSchema,
  SaveContentSchema,
} from './file-calls.ts';
export type { SaveContent } from './file-calls.ts';

/** Reserved registration ids: the panel toggle and the screenshot; others are command ids. */
export const PANEL_SHORTCUT_ID = 'togglePanel';
export const SCREENSHOT_SHORTCUT_ID = 'captureScreenshot';

export const ShortcutRegistrationSchema = Type.Object(
  {
    /** `togglePanel`, `captureScreenshot`, or the id of the command the shortcut launches. */
    id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    /** Electron accelerator grammar (`CommandOrControl+Shift+Space`), converted by Swift. */
    accelerator: Type.String({ minLength: 1, maxLength: 100 }),
  },
  { additionalProperties: false },
);

export const ShortcutResultSchema = Type.Union([
  Type.Object(
    { id: Type.String(), registered: Type.Literal(true) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: Type.String(),
      registered: Type.Literal(false),
      /** `unavailable`: the OS or another app holds it; `invalid`: Swift cannot express it. */
      reason: Type.Union([Type.Literal('unavailable'), Type.Literal('invalid')]),
    },
    { additionalProperties: false },
  ),
]);

/**
 * agent-contracts `McpServerIdSchema` as one pattern: an `Identifier`, or plugin-kit's qualified
 * name (`<plugin>:<server>`, whose pattern bounds it to 193 characters).
 */
const MCP_SERVER_ID_PATTERN =
  '^(?:[a-zA-Z0-9_-]{1,128}|(?:[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?:)?[A-Za-z0-9][A-Za-z0-9_-]{0,127})$';

/**
 * Mirrors agent-contracts `McpApprovalRequestResultSchema`; the native host returns it as that
 * type, so type checking catches a drift.
 */
const ApprovalRequestResultSchema = Type.Union([
  Type.Object({ approved: Type.Literal(true) }, { additionalProperties: false }),
  Type.Object(
    {
      approved: Type.Literal(false),
      /** `busy`: another native dialog is already showing. */
      reason: Type.Union([
        Type.Literal('cancelled'),
        Type.Literal('changed'),
        Type.Literal('unavailable'),
        Type.Literal('busy'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

/** What `screenshot.capture` and `screenshot.edit` answer. */
const ScreenshotResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      file: NativeFileRefSchema,
      context: Type.Union([NativeFileRefSchema, Type.Null()]),
      capturedAt: Type.String({ maxLength: 64 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      reason: Type.Union([Type.Literal('cancelled'), Type.Literal('notPermitted')]),
    },
    { additionalProperties: false },
  ),
]);

/** Input text limit shared with clipboard capture and the service's command input. */
export const MAX_CAPTURE_LENGTH = 100000;

/**
 * A rectangle in CSS pixels from the web view's top-left corner (what `getBoundingClientRect()`
 * reports in a page that is not scrolled inside the web view); Swift converts it to view points.
 */
const AnchorRectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/**
 * Calls: JS → Swift requests that Swift answers with a `result` carrying `result`, or an `error`
 * whose message the page shows as is.
 */
export const NativeCalls = {
  ...NativeWindowCalls,
  /**
   * Replaces the whole set of global shortcuts. Swift registers the difference and reports every
   * item. `selectionWanted`: an enabled command reads the selection, so each summon that shows the
   * panel captures the selection first (otherwise the stash is cleared).
   */
  'shortcuts.set': {
    params: Type.Object(
      {
        registrations: Type.Array(ShortcutRegistrationSchema, { maxItems: 256 }),
        selectionWanted: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Type.Object(
      { results: Type.Array(ShortcutResultSchema, { maxItems: 256 }) },
      { additionalProperties: false },
    ),
  },
  /** Takes the selection Swift stashed at the last summon (never a live read). */
  capture: {
    params: Type.Object({ source: Type.Literal('selection') }, { additionalProperties: false }),
    result: Type.Union([
      Type.Object(
        {
          ok: Type.Literal(true),
          text: Type.String({ minLength: 1, maxLength: MAX_CAPTURE_LENGTH }),
          capturedAt: Type.String({ maxLength: 64 }),
        },
        { additionalProperties: false },
      ),
      Type.Object(
        {
          ok: Type.Literal(false),
          /** Not trusted for Accessibility, nothing selected, or over `MAX_CAPTURE_LENGTH`. */
          reason: Type.Union([
            Type.Literal('notTrusted'),
            Type.Literal('noSelection'),
            Type.Literal('tooLong'),
          ]),
        },
        { additionalProperties: false },
      ),
    ]),
  },
  'clipboard.read': {
    params: Empty,
    result: Type.Object({ text: Type.String() }, { additionalProperties: false }),
  },
  'clipboard.write': {
    params: Type.Object({ text: Text(1000000) }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Lets the user capture an area, a window or the screen on the native capture overlay (element
   * detection, annotation), with the panel out of the way, and imports the image through
   * `/v1/resources/import`. The panel's visibility is restored afterwards. `context` is a Markdown
   * attachment imported beside the image (app and window, the picked interface element,
   * recognised text), or null when there is nothing to say. `notPermitted`: Screen Recording is
   * not granted (Swift asks once per launch); `cancelled`: the user dismissed the capture. An
   * import the service refuses rejects with its message.
   */
  'screenshot.capture': { params: Empty, result: ScreenshotResultSchema },
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
    result: ScreenshotResultSchema,
  },
  /**
   * Shows the system share picker for `text`, anchored to `anchor` in the window the call came
   * from. Resolves as soon as the picker is shown; whether the user picks a service or dismisses
   * it is not reported. Rejects when the text is blank or the web view is not in a window.
   */
  'share.text': {
    params: Type.Object(
      {
        text: Type.String({ minLength: 1, maxLength: MAX_NATIVE_TEXT_LENGTH }),
        anchor: AnchorRectSchema,
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /**
   * Reads `text` aloud, replacing any speech in progress. Resolves once speech is queued, not when
   * it ends: the `speech.state` event reports when it starts and ends. The voice follows the
   * text's dominant language and falls back to the system voice. Rejects when the text is blank.
   */
  'speech.speak': {
    params: Type.Object(
      { text: Type.String({ minLength: 1, maxLength: MAX_NATIVE_TEXT_LENGTH }) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /** Stops the speech in progress; resolves the same when nothing is being read. */
  'speech.stop': { params: Empty, result: Empty },
  /** Opens an http(s) link in the default browser; Swift checks the scheme again. */
  'link.open': {
    params: Type.Object(
      { url: Type.String({ maxLength: 8192, pattern: '^https?://' }) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  ...NativeFileCalls,
  /**
   * Confirms a launch approval in a native dialog the page cannot forge. Only the server id
   * crosses: Swift reads what would run from the service (`GET /v1/admin/approvals/mcp/:serverId`),
   * shows it, and on Allow approves with the fingerprint it showed (`via: 'shell'`).
   */
  'approval.request': {
    params: Type.Object(
      {
        kind: Type.Literal('mcpServer'),
        /** `McpServerIdSchema`: a user server's identifier, or `<plugin>:<server>`. */
        serverId: Type.String({ minLength: 1, maxLength: 193, pattern: MCP_SERVER_ID_PATTERN }),
      },
      { additionalProperties: false },
    ),
    result: ApprovalRequestResultSchema,
  },
  /**
   * Replaces what the selection toolbar offers over text selected in other apps; the page pushes
   * it whenever it changes. `commands`: the enabled commands that read the selection, in
   * command-list order; clicking one captures the selection and sends `shortcut.command`.
   */
  'toolbar.set': {
    params: Type.Object(
      {
        enabled: Type.Boolean(),
        excludedBundleIds: Type.Array(Type.String({ minLength: 1, maxLength: 255 }), {
          maxItems: 100,
        }),
        commands: Type.Array(
          Type.Object(
            {
              id: Type.String({ minLength: 1, maxLength: 128 }),
              name: Type.String({ minLength: 1, maxLength: 256 }),
            },
            { additionalProperties: false },
          ),
          { maxItems: 64 },
        ),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /**
   * Shows the system's Accessibility trust prompt while the app is not trusted, and opens System
   * Settings › Privacy & Security › Accessibility. `accessibility.trust` reports the outcome.
   */
  'accessibility.request': { params: Empty, result: Empty },
  /**
   * Shows the system's Screen Recording prompt while the app may not capture the screen, and opens
   * System Settings › Privacy & Security › Screen & System Audio Recording.
   * `screenRecording.trust` reports the outcome.
   */
  'screenRecording.request': { params: Empty, result: Empty },
  /** Open panel on application bundles, multiple selection; `apps` is empty when cancelled. */
  'apps.pick': {
    params: Empty,
    result: Type.Object(
      {
        apps: Type.Array(
          Type.Object(
            {
              bundleId: Type.String({ minLength: 1, maxLength: 255 }),
              name: Type.String({ minLength: 1, maxLength: 255 }),
            },
            { additionalProperties: false },
          ),
          { maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
  },
} satisfies Record<string, { params: TSchema; result: TSchema }>;
