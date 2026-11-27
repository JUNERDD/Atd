import { PermissionAnswerSchema } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { DiagBatchFrameSchema } from './diagnostics.ts';
import {
  CHROME_CHANNEL_PROTOCOL,
  ChromePrefsSchema,
  IdSchema as Id,
  InstallationIdSchema,
  OriginSchema as Origin,
  OwnInputSchema,
  PickedElementSchema,
  PointerPhaseSchema,
  RectSchema,
  RunViewSchema,
  SizeSchema,
  TabIdSchema as TabId,
  TargetIdSchema as TargetId,
  TextSchema as Text,
} from './payloads.ts';

export { CHROME_CHANNEL_PROTOCOL };

/**
 * K2 · the channel between Atd for Chrome and the Atd shell (`CHROME_CHANNEL_PROTOCOL = 1`).
 * This file is the source of truth; the shell mirrors it by hand in `AIChromeChannelKit` (Swift
 * Codable), so a change here is a change there too.
 *
 * Framing on both legs (Chrome ↔ native host stdio, host ↔ shell socket) is a uint32
 * little-endian length and one UTF-8 JSON object. Chrome caps host → extension messages at 1 MB,
 * so the shell splits a serialized frame over `CHUNK_THRESHOLD` bytes into `chunk` frames (`data`
 * = consecutive slices of the serialized frame string, `seq` from 0); the extension joins them in
 * order and drops an incomplete set on disconnect. Every frame is `{v: 1, t, …}`; an unknown `t`
 * is logged and ignored. Shell frames are checked with `Value.Check` (never the TypeBox compiler:
 * MV3's CSP forbids `eval`) and may carry fields this version does not know, which are ignored.
 * The payload shapes the frames carry (runs, requests, prefs) are in `payloads.ts`.
 */
export const CHUNK_THRESHOLD = 900_000;

const V = Type.Literal(CHROME_CHANNEL_PROTOCOL);
/**
 * The shell's id for one worker CDP connection (the loopback WebSocket's path uuid). A numeric id
 * is accepted too; the extension echoes the value unchanged.
 */
export const ConnIdSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.Integer(),
]);
export type ConnId = Static<typeof ConnIdSchema>;

// ── Extension → shell ────────────────────────────────────────────────────────
// Built by the extension itself; the schemas document them and back the `ExtensionFrame` type.

export const HelloFrameSchema = Type.Object({
  v: V,
  t: Type.Literal('hello'),
  installationId: InstallationIdSchema,
  extensionVersion: Type.String({ maxLength: 32 }),
  flavor: Type.Union([Type.Literal('release'), Type.Literal('dev')]),
  chromeVersion: Type.String({ maxLength: 64 }),
  /** Whether the person allowed the extension access to file URLs (uploads need it). */
  fileAccess: Type.Boolean(),
  /** The pairing secret, once paired; absent while unpaired. */
  secret: Type.Optional(Type.String({ maxLength: 256 })),
  profile: Type.Object({ label: Type.String({ maxLength: 200 }), email: Type.Optional(Text) }),
});

export const ExtensionFrameSchema = Type.Union([
  HelloFrameSchema,
  Type.Object({
    v: V,
    t: Type.Literal('pair.request'),
    code: Type.String({ minLength: 4, maxLength: 4 }),
  }),
  Type.Object({ v: V, t: Type.Literal('pair.cancel') }),
  /**
   * `url` and `title` are empty when the person removed the page from the request. `elements`: the
   * elements the person picked on that page with the in-page ask's inspector, in the order picked;
   * only together with the page (never with an empty `url`), and absent rather than empty.
   * `taskId`: the conversation the request continues, a task this profile started whose runs have
   * all ended; the shell then starts the task's next run instead of a new task (`ask.accepted`
   * names it), and refuses (`ask.failed`) a task it did not start for this profile or one still
   * running.
   */
  Type.Object({
    v: V,
    t: Type.Literal('ask'),
    requestId: Id,
    tabId: TabId,
    url: Text,
    title: Text,
    text: Text,
    taskId: Type.Optional(Id),
    elements: Type.Optional(Type.Array(PickedElementSchema, { minItems: 1, maxItems: 5 })),
    ownInput: Type.Optional(OwnInputSchema),
  }),
  Type.Object({ v: V, t: Type.Literal('run.stop'), taskId: Id, runId: Id }),
  Type.Object({
    v: V,
    t: Type.Literal('run.hold'),
    taskId: Id,
    runId: Id,
    tabId: TabId,
    held: Type.Boolean(),
    ownInput: Type.Optional(OwnInputSchema),
  }),
  Type.Object({
    v: V,
    t: Type.Literal('request.answer'),
    taskId: Id,
    requestId: Id,
    revision: Type.Integer({ minimum: 0 }),
    answer: PermissionAnswerSchema,
    ownInput: Type.Optional(OwnInputSchema),
  }),
  Type.Object({
    v: V,
    t: Type.Literal('run.followUp'),
    taskId: Id,
    kind: Type.Literal('saveAutomation'),
  }),
  Type.Object({ v: V, t: Type.Literal('site.set'), origin: Origin, allowed: Type.Boolean() }),
  Type.Object({ v: V, t: Type.Literal('app.open'), taskId: Type.Optional(Id) }),
  Type.Object({ v: V, t: Type.Literal('settings.open') }),
  /**
   * Owned tabs only. `lastInputAt`: ms since the epoch of the person's last input in the tab.
   * `runId` (v4): the run that owns the tab, also for tabs the shell never handed (opened by
   * `Target.createTarget`, popups and tabs opened from an owned tab); the shell accepts it only for
   * a run already tied to this Chrome, and the tab then joins that run's `RunView.tabs`.
   */
  Type.Object({
    v: V,
    t: Type.Literal('tab.state'),
    tabId: TabId,
    runId: Type.Optional(Id),
    targetId: Type.Optional(TargetId),
    url: Text,
    title: Text,
    active: Type.Boolean(),
    focused: Type.Boolean(),
    lastInputAt: Type.Optional(Type.Number()),
  }),
  Type.Object({
    v: V,
    t: Type.Literal('tab.released'),
    tabId: TabId,
    reason: Type.Union([
      Type.Literal('closed'),
      Type.Literal('ungrouped'),
      Type.Literal('canceledByUser'),
      Type.Literal('detached'),
    ]),
  }),
  Type.Object({
    v: V,
    t: Type.Literal('tab.opened'),
    requestId: Id,
    tabId: TabId,
    targetId: TargetId,
  }),
  /** `tab.open` could not open or own the tab; `reason` is a log line, never shown as copy. */
  Type.Object({
    v: V,
    t: Type.Literal('tab.openFailed'),
    requestId: Id,
    reason: Type.String({ maxLength: 500 }),
  }),
  Type.Object({ v: V, t: Type.Literal('tab.handed'), runId: Id, tabId: TabId, targetId: TargetId }),
  /** v4. The HUD's Dismiss on a terminal run: the shell may forget the run's `RunView` (S10). */
  Type.Object({ v: V, t: Type.Literal('run.dismiss'), taskId: Id, runId: Id }),
  /** `msg`: one CDP JSON message of the emulated browser (a response or an event). */
  Type.Object({ v: V, t: Type.Literal('cdp'), conn: ConnIdSchema, msg: Type.String() }),
  DiagBatchFrameSchema,
]);
export type ExtensionFrame = Static<typeof ExtensionFrameSchema>;
export type HelloFrame = Static<typeof HelloFrameSchema>;

// ── Shell → extension ────────────────────────────────────────────────────────

export const HostStateSchema = Type.Union([
  Type.Literal('ready'),
  /** Another Atd build owns the channel (Debug and Release side by side). */
  Type.Literal('otherHost'),
  /** The shell runs but its service does not answer. */
  Type.Literal('serviceUnavailable'),
]);
export type HostState = Static<typeof HostStateSchema>;

export const PairStateSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('paired'),
  Type.Literal('denied'),
  Type.Literal('error'),
]);
export type PairState = Static<typeof PairStateSchema>;

/**
 * Unreferenced (`ref === undefined`) `error` frame codes the shell sends before closing a
 * rejected connection (`ChromeChannelErrorCode` in `AIChromeChannelKit`).
 */
export const CHANNEL_REJECTION_CODES = [
  'browserNotVerified',
  'browserMismatch',
  'originMismatch',
] as const;
export type ChannelRejectionCode = (typeof CHANNEL_REJECTION_CODES)[number];

export const ShellFrameSchema = Type.Union([
  Type.Object({
    v: V,
    t: Type.Literal('welcome'),
    paired: Type.Boolean(),
    installationId: Id,
    label: Type.Optional(Type.String({ maxLength: 200 })),
    /** The shell-verified browser name (e.g. `Aside`, `Google Chrome`), when available. */
    browser: Type.Optional(Type.String({ maxLength: 200 })),
    appVersion: Type.String({ maxLength: 64 }),
    prefs: ChromePrefsSchema,
    sites: Type.Array(Origin, { maxItems: 1000 }),
    hostState: HostStateSchema,
  }),
  /**
   * `secret` comes only with `paired`; the extension stores it and sends it in `hello`. `reason`
   * (with `denied`/`error`) is a code, never shown as is: `busy`, `cooldown`, `unavailable`,
   * `failed`, `otherHost`, `serviceUnavailable`, `denied` (`PAIR_FAILURES`); others read as generic.
   */
  Type.Object({
    v: V,
    t: Type.Literal('pair.state'),
    state: PairStateSchema,
    code: Type.Optional(Type.String({ maxLength: 16 })),
    secret: Type.Optional(Type.String({ maxLength: 256 })),
    label: Type.Optional(Type.String({ maxLength: 200 })),
    reason: Type.Optional(Text),
  }),
  Type.Object({ v: V, t: Type.Literal('unpaired') }),
  Type.Object({ v: V, t: Type.Literal('prefs'), ...ChromePrefsSchema.properties }),
  Type.Object({ v: V, t: Type.Literal('sites'), origins: Type.Array(Origin, { maxItems: 1000 }) }),
  /** The complete set of runs tied to this Chrome (at most 8), sent whenever it changes. */
  Type.Object({ v: V, t: Type.Literal('runs'), runs: Type.Array(RunViewSchema, { maxItems: 8 }) }),
  /**
   * The live pointer (CSS px of page `pageId` = a tab's CDP target id). `label` is the step kind
   * in progress (`ComputerStepKind`), or empty when the host reports none.
   */
  Type.Object({
    v: V,
    t: Type.Literal('pointer'),
    pageId: TargetId,
    phase: PointerPhaseSchema,
    label: Type.String({ maxLength: 64 }),
    rect: Type.Optional(RectSchema),
    viewport: Type.Optional(SizeSchema),
  }),
  /** Own this tab for a run (put it in the Atd group); answered by `tab.handed`. */
  Type.Object({ v: V, t: Type.Literal('tab.hand'), runId: Id, tabId: TabId }),
  /** Open a background tab in the Atd group for a run; answered by `tab.opened`. */
  Type.Object({
    v: V,
    t: Type.Literal('tab.open'),
    requestId: Id,
    runId: Id,
    url: Type.String({ minLength: 1, maxLength: 8192 }),
  }),
  Type.Object({ v: V, t: Type.Literal('cdp.open'), conn: ConnIdSchema }),
  Type.Object({ v: V, t: Type.Literal('cdp.close'), conn: ConnIdSchema }),
  /** `msg`: one CDP JSON message from the worker. */
  Type.Object({ v: V, t: Type.Literal('cdp'), conn: ConnIdSchema, msg: Type.String() }),
  Type.Object({ v: V, t: Type.Literal('ask.accepted'), requestId: Id, taskId: Id, runId: Id }),
  /** `reason` is a code: `otherHost`, `serviceUnavailable`, `failed`; others read as `failed`. */
  Type.Object({ v: V, t: Type.Literal('ask.failed'), requestId: Id, reason: Text }),
  Type.Object({
    v: V,
    t: Type.Literal('error'),
    ref: Type.Optional(Type.String({ maxLength: 256 })),
    code: Type.String({ maxLength: 128 }),
    message: Text,
  }),
]);
export type ShellFrame = Static<typeof ShellFrameSchema>;

/** One slice of a frame the shell split; joined before `ShellFrameSchema` sees the whole. */
export const ChunkFrameSchema = Type.Object({
  v: V,
  t: Type.Literal('chunk'),
  id: Type.String({ minLength: 1, maxLength: 128 }),
  seq: Type.Integer({ minimum: 0 }),
  last: Type.Boolean(),
  data: Type.String(),
});
export type ChunkFrame = Static<typeof ChunkFrameSchema>;

/** A shell frame of type `T`. */
export type ShellFrameOf<T extends ShellFrame['t']> = Extract<ShellFrame, { t: T }>;
/** An extension frame of type `T`, without the envelope's `v` (the sender adds it). */
export type ExtensionFrameBody<T extends ExtensionFrame['t']> = Omit<
  Extract<ExtensionFrame, { t: T }>,
  'v'
>;
