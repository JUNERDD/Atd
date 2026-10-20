/**
 * Computer use across the native bridge (`contract.ts`): the settings page asks the shell to
 * prepare targets (a managed browser profile or an application), reopen a profile for signing in,
 * confirm an automation's computer scope in a native dialog the page cannot forge, show or hide
 * the live pointer, and prepare screen capture so macOS never asks for it in the middle of a run.
 * The shell reports its computer host state. Computer use only ever acts in the background: no
 * call lets the page bring a target forward or hand it the person's pointer. Binding content and
 * grants reach the service only from the shell (shell-only routes), never from the page. Like the
 * rest of the contract, the export script loads this file with Node's type stripping, so it
 * imports nothing but TypeBox and its sibling contract files (by their `.ts` names) and uses only
 * erasable TypeScript syntax.
 */
import { Type } from 'typebox';
import { ComputerPreviewSourceSchema } from './computer-preview-calls.ts';
import { Empty } from './primitives.ts';

/** agent-contracts `Identifier`. */
const IdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' });
const LabelSchema = Type.String({ minLength: 1, maxLength: 120 });
/** agent-contracts `ComputerActionIdSchema`. */
const ActionIdSchema = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});
/** An ISO 8601 instant, as `Date.prototype.toISOString` writes it. */
const DateTimeSchema = Type.String({ format: 'date-time', maxLength: 64 });

/** Mirrors agent-contracts `ComputerPrepareResultSchema`; the native host returns it as that type. */
const PrepareResultSchema = Type.Union([
  Type.Object(
    {
      ok: Type.Literal(true),
      bindingId: IdSchema,
      revision: Type.Integer({ minimum: 1 }),
      /**
       * An application's read-only probe: its standard windows and whether the tree and a
       * screenshot were readable. The probe never opens or activates the app.
       */
      probe: Type.Optional(
        Type.Object(
          {
            windows: Type.Integer({ minimum: 0 }),
            tree: Type.Boolean(),
            screenshot: Type.Boolean(),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ok: Type.Literal(false),
      /**
       * `cancelled`: the person closed it; `unavailable`: no host or service; `busy`: in use;
       * `unsupported`: the app cannot be a target; `notInstalled`: the app is not at its path.
       */
      reason: Type.Union([
        Type.Literal('cancelled'),
        Type.Literal('unavailable'),
        Type.Literal('busy'),
        Type.Literal('unsupported'),
        Type.Literal('notInstalled'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

/**
 * Mirrors agent-contracts `ComputerAuthorizationResultSchema`; the native host returns it as that
 * type, so type checking catches a drift.
 */
const AuthorizationResultSchema = Type.Union([
  Type.Object(
    { approved: Type.Literal(true), grantId: IdSchema, version: Type.Integer({ minimum: 1 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      approved: Type.Literal(false),
      reason: Type.Union([
        Type.Literal('cancelled'),
        Type.Literal('changed'),
        Type.Literal('notQualified'),
        Type.Literal('unavailable'),
        Type.Literal('busy'),
      ]),
    },
    { additionalProperties: false },
  ),
]);

export const NativeComputerCalls = {
  /** Small system artwork for an installed application; never opens or registers the app. */
  'computer.applicationIcon': {
    params: Type.Object(
      { bundleId: Type.String({ minLength: 1, maxLength: 255 }) },
      { additionalProperties: false },
    ),
    result: Type.Object(
      { pngBase64: Type.Union([Type.String({ maxLength: 65536 }), Type.Null()]) },
      { additionalProperties: false },
    ),
  },
  /** Installed app identities for mentions; listing never registers or opens a target. */
  'computer.listApplications': {
    params: Empty,
    result: Type.Object(
      {
        applications: Type.Array(
          Type.Object(
            {
              bundleId: Type.String({ minLength: 1, maxLength: 255 }),
              name: Type.String({ minLength: 1, maxLength: 255 }),
            },
            { additionalProperties: false },
          ),
          { maxItems: 2048 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  /**
   * Creates a managed browser profile, opens it at `startUrl` for the person to sign in, and
   * registers the prepared target with the service once they finish. `allowedOrigins` are
   * `scheme://host[:port]` origins (agent-contracts `ComputerOriginSchema`).
   */
  'computer.prepareBrowser': {
    params: Type.Object(
      {
        label: LabelSchema,
        startUrl: Type.String({ minLength: 1, maxLength: 2048, pattern: '^https?://' }),
        allowedOrigins: Type.Array(
          Type.String({ minLength: 1, maxLength: 512, pattern: '^https?://[^/?#\\s]+$' }),
          { minItems: 1, maxItems: 20 },
        ),
      },
      { additionalProperties: false },
    ),
    result: PrepareResultSchema,
  },
  /**
   * Registers an application as a target; `bundleId` names it and the shell resolves and checks
   * its install location itself. Answers with a read-only probe on success.
   */
  'computer.prepareApplication': {
    params: Type.Object(
      { label: LabelSchema, bundleId: Type.String({ minLength: 1, maxLength: 255 }) },
      { additionalProperties: false },
    ),
    result: PrepareResultSchema,
  },
  /**
   * Opens a browser binding's managed profile in front, on the person's click: to sign in again,
   * or for a run whose browser could not start in the background (`noBackgroundRoute` with
   * `openBrowser`). Nothing a run does opens it this way.
   */
  'computer.openProfile': {
    params: Type.Object({ bindingId: IdSchema }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Confirms an automation's computer scope in a native dialog. Only the automation crosses:
   * Swift reads the exact scope from the service, shows it, and on Allow approves with the hash it
   * showed; `changed` when the automation moved past `expectedRevision`.
   */
  'computer.authorizeAutomation': {
    params: Type.Object(
      { automationId: IdSchema, expectedRevision: Type.Integer({ minimum: 1 }) },
      { additionalProperties: false },
    ),
    result: AuthorizationResultSchema,
  },
  /**
   * The person checked the apps and sites the listed actions may have changed (`computer.state`
   * `unsettled`): the host records them settled with an unknown effect, which reopens background
   * computer use once nothing else is open. Ids the host does not hold as unsettled are ignored.
   */
  'computer.acknowledgeUnsettled': {
    params: Type.Object(
      { actionIds: Type.Array(ActionIdSchema, { minItems: 1, maxItems: 50, uniqueItems: true }) },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /** Local typing preferences; the first opt-in also enables an unchosen highlight. */
  'computer.setTyping': {
    params: Type.Object(
      {
        setting: Type.Union([Type.Literal('typing'), Type.Literal('animation')]),
        enabled: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    result: Empty,
  },
  /** Shows or hides the live pointer that follows computer actions on screen. */
  'computer.setPointerVisible': {
    params: Type.Object({ visible: Type.Boolean() }, { additionalProperties: false }),
    result: Empty,
  },
  /**
   * Prepares screen capture for this app build. Only Settings › Computer use sends it, when the
   * person asks for it; nothing during a run does. The shell captures a small region of a display
   * once, directly, so macOS asks for its screen-capture consent now instead of in the middle of a
   * task, and on success records the time with this app's bundle id (`computer.state`
   * `captureConsent`). `prepared`: the capture succeeded at `primedAt`; `denied`: macOS refused it
   * (Screen Recording is off for Atd, or the person declined); `unavailable`: the shell could not
   * try now (no display to capture, a screenshot in progress, shutting down).
   */
  'computer.primeCaptureConsent': {
    params: Empty,
    result: Type.Union([
      Type.Object(
        { state: Type.Literal('prepared'), primedAt: DateTimeSchema },
        { additionalProperties: false },
      ),
      Type.Object({ state: Type.Literal('denied') }, { additionalProperties: false }),
      Type.Object({ state: Type.Literal('unavailable') }, { additionalProperties: false }),
    ]),
  },
};

export const NativeComputerEvents = {
  /**
   * The shell's computer host, sent to the settings page on each change and replayed when its
   * page becomes ready. `host`: `ready` (this app holds the host lock and the service bound it),
   * `locked` (another Atd process holds the lock), `starting`, or `unavailable` (no service
   * connection). Each engine reports whether it can serve runs: the app engine (`atd`) is part of
   * the app, and the browser engine (`playwright`) is `notInstalled` while its add-on is absent (no
   * capability profile is published for it); `detail` is runtime text for the person, not
   * translated. `unsettled`: actions whose effect the host could not confirm and no service record
   * settled; background computer use stays paused until a person checked the affected apps and
   * sites (`computer.acknowledgeUnsettled`). Only ids and a count cross.
   */
  'computer.state': Type.Object(
    {
      host: Type.Union([
        Type.Literal('starting'),
        Type.Literal('ready'),
        Type.Literal('locked'),
        Type.Literal('unavailable'),
      ]),
      pointerVisible: Type.Boolean(),
      typing: Type.Boolean(),
      typingAnimation: Type.Boolean(),
      previews: Type.Array(ComputerPreviewSourceSchema, { maxItems: 4 }),
      engines: Type.Array(
        Type.Object(
          {
            engine: Type.Union([Type.Literal('playwright'), Type.Literal('atd')]),
            state: Type.Union([
              Type.Literal('starting'),
              Type.Literal('ready'),
              Type.Literal('unqualified'),
              Type.Literal('unavailable'),
              Type.Literal('notInstalled'),
            ]),
            detail: Type.String({ maxLength: 500 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 4 },
      ),
      unsettled: Type.Object(
        {
          count: Type.Integer({ minimum: 0 }),
          /** The first 50 of them. */
          actionIds: Type.Array(ActionIdSchema, { maxItems: 50 }),
        },
        { additionalProperties: false },
      ),
      /**
       * Screen capture prepared for this app build (`computer.primeCaptureConsent`): the bundle id
       * the record was made for, which is this app's own, and when the capture succeeded; null
       * while no record exists for this bundle id. A run nobody watches never makes macOS ask, so
       * until then it refuses to capture (`needsConsent`); an attended run still captures, and
       * macOS may ask during it.
       */
      captureConsent: Type.Union([
        Type.Object(
          { bundleId: Type.String({ minLength: 1, maxLength: 255 }), primedAt: DateTimeSchema },
          { additionalProperties: false },
        ),
        Type.Null(),
      ]),
      /**
       * Whether macOS lets this app post input events to other apps (`CGPreflightPostEventAccess`,
       * read with each state), which an app target needs for every step that is not an
       * accessibility action. System Settings lists this grant under Accessibility, so a missing
       * one shows the Accessibility guidance.
       */
      postEventAccess: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
};
