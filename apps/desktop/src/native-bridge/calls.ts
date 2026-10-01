/**
 * Calls of the native bridge (`contract.ts`): the JS → Swift requests Swift answers, with the
 * schemas their params and results use. Like the rest of the contract, the export script loads this
 * file with Node's type stripping, so it imports nothing but TypeBox and uses only erasable
 * TypeScript syntax.
 */
import { Type, type TSchema } from 'typebox';

/** A call or post without params, or a result without a value. */
export const Empty = Type.Object({}, { additionalProperties: false });
export const Text = (maxLength: number) => Type.String({ maxLength });
/**
 * Mirrors `FileRefSchema` (`src/client/agent/task-schema.ts`); the WebView host returns it where a
 * `FileRef` is expected, so type checking catches a drift.
 */
export const NativeFileRefSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }),
    name: Text(255),
    size: Type.Integer({ minimum: 0 }),
    type: Text(100),
  },
  { additionalProperties: false },
);
const Resources = Type.Object(
  { resources: Type.Array(NativeFileRefSchema, { maxItems: 10 }) },
  { additionalProperties: false },
);

/** The id of the panel toggle registration; every other shortcut registration is a command id. */
export const PANEL_SHORTCUT_ID = 'togglePanel';

export const ShortcutRegistrationSchema = Type.Object(
  {
    /** `togglePanel`, or the id of the command the shortcut launches. */
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

/** Input text limit shared with clipboard capture and the service's command input. */
export const MAX_CAPTURE_LENGTH = 100000;
/** Longest text `share.text` and `speech.speak` take, the same bound as `clipboard.write`. */
const MAX_NATIVE_TEXT_LENGTH = 1000000;

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
  /** Shows and focuses the panel. */
  'window.show': { params: Empty, result: Empty },
  /** Hides the panel (alpha 0; it stays ordered in). */
  'window.hide': { params: Empty, result: Empty },
  'window.setPinned': {
    params: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ pinned: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Window and app preferences the shell owns; `openAtLogin` is null where unsupported. */
  'app.state': {
    params: Empty,
    result: Type.Object(
      {
        pinned: Type.Boolean(),
        showInDock: Type.Boolean(),
        openAtLogin: Type.Union([Type.Boolean(), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  'app.setShowInDock': {
    params: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ show: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Resolves to the applied state, false while macOS waits for approval in System Settings. */
  'app.setOpenAtLogin': {
    params: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
    result: Type.Object({ open: Type.Boolean() }, { additionalProperties: false }),
  },
  /** Shows the settings window; a first load opens `commandId`'s editor when it is set. */
  'settings.open': {
    params: Type.Object(
      { commandId: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  'settings.close': { params: Empty, result: Empty },
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
  /** Downloads the artifact through the service, then opens, reveals, or copies its path. */
  artifact: {
    params: Type.Object(
      {
        artifactId: Type.String({ minLength: 1, maxLength: 128 }),
        operation: Type.Union([
          Type.Literal('open'),
          Type.Literal('reveal'),
          Type.Literal('copyPath'),
        ]),
      },
      { additionalProperties: false },
    ),
    result: NativeFileRefSchema,
  },
  /** Open panel for attachments, imported through `/v1/resources/import`; `[]` when cancelled. */
  'files.pick': { params: Empty, result: Resources },
  /** Save panel for a service resource; `saved` is false when cancelled. */
  'files.save': {
    params: Type.Object(
      { resourceId: Type.String({ minLength: 1, maxLength: 128 }), name: Text(255) },
      { additionalProperties: false },
    ),
    result: Type.Object({ saved: Type.Boolean() }, { additionalProperties: false }),
  },
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
} satisfies Record<string, { params: TSchema; result: TSchema }>;
