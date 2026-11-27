import { Type, type Static } from 'typebox';

/**
 * K2 payloads: the shapes the channel's frames carry (`protocol.ts` holds the frames). Part of the
 * K2 source of truth that the shell mirrors in `AIChromeChannelKit`; change both together.
 */

export const IdSchema = Type.String({ minLength: 1, maxLength: 256 });
export const TextSchema = Type.String({ maxLength: 100_000 });
/** Chrome's `tabs.Tab.id`. */
export const TabIdSchema = Type.Integer({ minimum: 0 });
/** CDP target id of a tab (`chrome.debugger.getTargets`), which the worker sees as `pageId`. */
export const TargetIdSchema = Type.String({ minLength: 1, maxLength: 128 });
/**
 * The extension's installation id: an `Identifier` as the service validates it (generated with
 * `crypto.randomUUID`; a stored id that does not match is replaced, and pairing starts over).
 */
export const InstallationIdSchema = Type.String({ pattern: '^[A-Za-z0-9_-]{1,128}$' });
/** An origin such as `https://example.com` (scheme, host and port, no path). */
export const OriginSchema = Type.String({ minLength: 1, maxLength: 2048 });
const Id = IdSchema;
const Text = TextSchema;
const TabId = TabIdSchema;
const Language = Type.Union([Type.Literal('en'), Type.Literal('zh-CN')]);

/** Settings Atd forwards: the service's `language` and the workspace's `glowEffects` (D13). */
export const ChromePrefsSchema = Type.Object({ language: Language, glowEffects: Type.Boolean() });
export type ChromePrefs = Static<typeof ChromePrefsSchema>;

/**
 * A pending request the HUD can answer (D10). A confirmation is answered Allow once
 * (`{decision: 'once'}`) or Don't allow (`{decision: 'declined'}`); an input with options by one
 * of them (`{answer}`); an input without options only in Atd. `revision` is echoed back so a stale
 * answer loses to the first one given anywhere.
 */
export const HudRequestSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('confirmation'),
    requestId: Id,
    revision: Type.Integer({ minimum: 0 }),
    title: Text,
    detail: Text,
    /** The action's effect rank (`read` … `submit`), when the request is a computer act. */
    effect: Type.Optional(Type.String({ maxLength: 32 })),
  }),
  Type.Object({
    kind: Type.Literal('input'),
    requestId: Id,
    revision: Type.Integer({ minimum: 0 }),
    title: Text,
    options: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 8 }),
  }),
]);
export type HudRequest = Static<typeof HudRequestSchema>;

export const RunStatusSchema = Type.Union([
  Type.Literal('working'),
  Type.Literal('attention'),
  Type.Literal('held'),
  Type.Literal('stopping'),
  Type.Literal('stopped'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('disconnected'),
]);
export type RunStatus = Static<typeof RunStatusSchema>;

/**
 * A run's reply (clipped where the shell clipped it). Once the run is done it is its answer; while
 * it runs, the message it is writing or wrote last (`state`), which its next message replaces:
 * `writing` while it has started no other step since, `paused` once it went on to one.
 */
export const RunResultSchema = Type.Object({
  text: Text,
  clipped: Type.Boolean(),
  state: Type.Optional(Type.Union([Type.Literal('writing'), Type.Literal('paused')])),
});
export type RunResult = Static<typeof RunResultSchema>;

/**
 * A run tied to this Chrome, as the shell projects task activity and computer progress. `tabs`
 * are the tabs it owns; `result` is its reply (`RunResultSchema`) for runs started from the
 * extension, live while it runs; a run that stopped or failed has none.
 * `title` is the task's (named after its first request); `prompt`, for runs started from the
 * extension, is what the person sent to start this run, so the turns of one conversation (runs
 * of one task) each show their own request.
 */
export const RunViewSchema = Type.Object({
  taskId: Id,
  runId: Id,
  title: Text,
  prompt: Type.Optional(Text),
  status: RunStatusSchema,
  step: Type.Optional(Text),
  tabs: Type.Array(TabId, { maxItems: 64 }),
  focusTabId: Type.Optional(TabId),
  requests: Type.Array(HudRequestSchema, { maxItems: 16 }),
  result: Type.Optional(RunResultSchema),
  problem: Type.Optional(Type.Object({ code: Type.String({ maxLength: 128 }), message: Text })),
  fromExtension: Type.Boolean(),
});
export type RunView = Static<typeof RunViewSchema>;

/** `computer.progress` phases (`ComputerProgressPhase`); `cleared` hides the pointer. */
export const PointerPhaseSchema = Type.Union([
  Type.Literal('locating'),
  Type.Literal('dispatching'),
  Type.Literal('waiting'),
  Type.Literal('verifying'),
  Type.Literal('done'),
  Type.Literal('failed'),
  Type.Literal('cleared'),
]);
export type PointerPhase = Static<typeof PointerPhaseSchema>;

export const RectSchema = Type.Object({
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
});
export const SizeSchema = Type.Object({
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
});

/** An element the person picked on the page with the in-page ask's inspector. */
export const PickedElementSchema = Type.Object({
  /** A CSS selector that matched only this element in the top document when it was picked. */
  selector: Type.String({ minLength: 1, maxLength: 1_000 }),
  /** What it is, for a person: its role or tag and its accessible name, e.g. `button "Sign up"`. */
  label: Type.String({ minLength: 1, maxLength: 300 }),
  /** Its visible text, whitespace collapsed to single spaces, no newlines, clipped; empty when none. */
  text: Type.String({ maxLength: 1_000 }),
});
export type PickedElement = Static<typeof PickedElementSchema>;

/**
 * Source-stamped hardware input timestamps (ms since 1970) recorded on Atd's own in-page HUD layer
 * within the active-use window, keyed by macOS `CGEventType` equivalent so the host verifies and
 * attributes only those exact HUD events without masking page input.
 */
export const OwnInputSchema = Type.Object({
  keyDown: Type.Optional(Type.Number({ minimum: 0 })),
  leftMouseDown: Type.Optional(Type.Number({ minimum: 0 })),
  rightMouseDown: Type.Optional(Type.Number({ minimum: 0 })),
  otherMouseDown: Type.Optional(Type.Number({ minimum: 0 })),
  scrollWheel: Type.Optional(Type.Number({ minimum: 0 })),
});
export type OwnInput = Static<typeof OwnInputSchema>;
