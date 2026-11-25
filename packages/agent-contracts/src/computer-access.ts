import { Type, type Static } from 'typebox';
import { ComputerUrlSchema } from './computer-actions.js';
import { TargetBindingContentSchema, TargetBindingSchema } from './computer-targets.js';

/**
 * Which browser opens a website: `chrome`, the person's own Chrome through Atd for Chrome (their
 * signed-in sessions, attended runs only, a binding on the `chrome` channel), or `managed`, a
 * separate browser profile the host manages.
 */
export const ComputerAccessBrowserSchema = Type.Union([
  Type.Literal('chrome'),
  Type.Literal('managed'),
]);
export type ComputerAccessBrowser = Static<typeof ComputerAccessBrowserSchema>;

const applicationTarget = Type.Object(
  {
    kind: Type.Literal('application'),
    application: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);

/**
 * An attended request for a specific installed application or website, never arbitrary paths. A
 * website without `browser` opens in the run's default browser: `chrome` when the run was started
 * with `browser: 'chrome'` (`RunComputer.browser`), else `managed`.
 */
export const ComputerAccessTargetSchema = Type.Union([
  applicationTarget,
  Type.Object(
    {
      kind: Type.Literal('website'),
      url: ComputerUrlSchema,
      browser: Type.Optional({
        ...ComputerAccessBrowserSchema,
        description:
          "website only: chrome = the person's own Chrome through Atd for Chrome, with their signed-in sessions (attended only; submits always ask); managed = Atd's separate browser profile. Omit for the run's default: chrome when the task came from Atd for Chrome, else managed.",
      }),
    },
    { additionalProperties: false },
  ),
]);
export type ComputerAccessTarget = Static<typeof ComputerAccessTargetSchema>;

/** What the host is asked to prepare: a website always names the browser the service resolved. */
export const PreparedComputerAccessTargetSchema = Type.Union([
  applicationTarget,
  Type.Object(
    { kind: Type.Literal('website'), url: ComputerUrlSchema, browser: ComputerAccessBrowserSchema },
    { additionalProperties: false },
  ),
]);
export type PreparedComputerAccessTarget = Static<typeof PreparedComputerAccessTargetSchema>;

/**
 * Approval is scoped to the identity the host resolved and how long it lasts. The scope carries no
 * delivery: opening a target never brings it forward, and how each later step is delivered is the
 * host's own choice within what the run allows (`ComputerDelivery`).
 */
export const ComputerAccessScopeSchema = Type.Object(
  {
    tool: Type.Literal('computerAccess'),
    target: TargetBindingContentSchema,
    persistence: Type.Union([Type.Literal('run'), Type.Literal('saved')]),
  },
  { additionalProperties: false },
);

/**
 * Resolution reads installation metadata only; opening is sent only after the service gate. A
 * website's candidate carries `channel: 'chrome'` exactly when `browser` is `chrome`, with the
 * paired Chrome's installation id as its `profileId`.
 */
export const PrepareComputerAccessSchema = Type.Object(
  {
    kind: Type.Literal('prepareAccess'),
    target: PreparedComputerAccessTargetSchema,
  },
  { additionalProperties: false },
);

/**
 * Opens an approved target without bringing anything forward: a running app or browser is left
 * where it is, and a page opens in a background tab. `persistent` keeps the browser profile the
 * binding names after the run.
 */
export const OpenComputerAccessSchema = Type.Object(
  {
    kind: Type.Literal('openAccess'),
    binding: TargetBindingSchema,
    persistent: Type.Boolean(),
  },
  { additionalProperties: false },
);
export const ComputerAccessCandidateSchema = Type.Object(
  {
    kind: Type.Literal('accessCandidate'),
    content: TargetBindingContentSchema,
  },
  { additionalProperties: false },
);

/**
 * The target is open. `activated` says whether opening it made any app active anyway (a browser
 * that had to start may take the front), so what the person is told stays true.
 */
export const ComputerAccessOpenedSchema = Type.Object(
  {
    kind: Type.Literal('accessOpened'),
    activated: Type.Boolean(),
  },
  { additionalProperties: false },
);
