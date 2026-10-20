import { Type, type Static } from 'typebox';

/**
 * The closed vocabulary of the `computer` tool (docs/plans/2026-10-16-background-computer-use.md
 * §5, §8; docs/plans/2026-10-17-general-computer-use.md §4–§5;
 * docs/plans/2026-10-19-imperceptible-computer-use.md §3, §5): ids, the effects a step can have,
 * the registered step kinds, how an action is delivered and the routes it can take. Locators and
 * conditions live in `computer-locators.ts`, steps and actions in `computer-steps.ts`. There is
 * still no raw script, `evaluate` or free-form keystroke: a step outside these files cannot be
 * expressed, so the hard scope check and the host's engine profile can both reason about every
 * step by its `kind`.
 */

/** Steps one `act` may carry; each write step still checks cancellation and conditions on its own. */
export const COMPUTER_MAX_STEPS = 12;
/** Longest text one `fill`, `setValue` or `type` step inserts. */
export const COMPUTER_TEXT_MAX_LENGTH = 20000;
/** Longest wait one `wait` step may block for. */
export const COMPUTER_WAIT_MAX_MS = 30000;
/** Longest URL a step, condition or binding names. */
export const COMPUTER_URL_MAX_LENGTH = 2048;

/**
 * An opaque runtime id the host mints (target refs, observation refs, element refs, pages,
 * surfaces, captures). It is valid only within the host generation and observation it came from
 * and is never persisted as authorization.
 */
export const ComputerRefIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: '^[A-Za-z0-9_.:-]+$',
});

/** A lowercase hex SHA-256 digest; the service computes every hash over `canonicalJson`. */
export const ComputerHashSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });

/** An action id: a UUID the model may choose, or the service mints when the model leaves it out. */
export const ComputerActionIdSchema = Type.String({
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
});

/** A recipe step's stable id (`ComputerRecipeStep.stepId`), unique within its recipe. */
export const ComputerStepIdSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-zA-Z0-9_-]+$',
});

/** An absolute http(s) URL; `navigate` targets and `urlMatches` prefixes use it. */
export const ComputerUrlSchema = Type.String({
  minLength: 1,
  maxLength: COMPUTER_URL_MAX_LENGTH,
  pattern: '^https?://',
});

/**
 * What a step does to the world. `read` has no side effect; `navigate`, `input` and `click` change
 * UI state a person could undo; `invoke` is a UI action whose business effect is unknown (a click
 * on an arbitrary point, a shortcut, a menu command, a drag), so it always needs approval and no
 * recipe step can carry it; `submit` has a business side effect. Unattended runs do at most
 * `maxSubmits` submits and no business effect is ever retried automatically.
 */
export const ComputerEffectSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('navigate'),
  Type.Literal('input'),
  Type.Literal('click'),
  Type.Literal('invoke'),
  Type.Literal('submit'),
]);
export type ComputerEffect = Static<typeof ComputerEffectSchema>;

/** How far each effect reaches; an action's approval key is its highest-ranked step effect. */
export const COMPUTER_EFFECT_RANK: Readonly<Record<ComputerEffect, number>> = {
  read: 0,
  navigate: 1,
  input: 2,
  click: 3,
  invoke: 4,
  submit: 5,
};

/**
 * Effects with a business side effect, or one that may have it (`invoke`): never retried
 * automatically. Unattended runs count `submit` against `maxSubmits` and never carry `invoke`.
 */
export const COMPUTER_BUSINESS_EFFECTS: readonly ComputerEffect[] = ['invoke', 'submit'];

/** Whether an effect is (or may be) a business side effect (`invoke`, `submit`). */
export function isBusinessEffect(effect: ComputerEffect): boolean {
  return COMPUTER_BUSINESS_EFFECTS.includes(effect);
}

/**
 * The registered step kinds (`COMPUTER_STEP_KINDS_FOR_KIND` says which a target kind takes).
 * `press` is a semantic accessibility press; `click` acts on a point or element as a pointer
 * would; `select` chooses a list option and `upload` sets task files on a file input (browser
 * only). There is no hover step: hovering and tooltips have no background route.
 */
export const ComputerStepKindSchema = Type.Union([
  Type.Literal('navigate'),
  Type.Literal('fill'),
  Type.Literal('press'),
  Type.Literal('scroll'),
  Type.Literal('wait'),
  Type.Literal('setValue'),
  Type.Literal('click'),
  Type.Literal('key'),
  Type.Literal('type'),
  Type.Literal('clear'),
  Type.Literal('menu'),
  Type.Literal('drag'),
  Type.Literal('select'),
  Type.Literal('upload'),
]);
export type ComputerStepKind = Static<typeof ComputerStepKindSchema>;

/**
 * How an action reaches its target. `background` is the only delivery: the imperceptible contract
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §3) under which the host never moves the
 * person's pointer, never activates, raises or minimizes a window, hands back any key focus it
 * borrows before that input ends, opens no visible menu, and leaves the Space and the clipboard
 * alone. A step without such a route is refused (`noBackgroundRoute`), never escalated. Neither
 * the model nor a run chooses it; it stays a reported fact (results, capability profiles) so
 * another delivery could be added later without reshaping them.
 */
export const ComputerDeliverySchema = Type.Literal('background');
export type ComputerDelivery = Static<typeof ComputerDeliverySchema>;

/**
 * The route an action takes to its target: the accessibility API, synthesized input events posted
 * to the target process, a menu command, an app script the host owns, or CDP. The host picks it
 * per step; results report the route that ran and target capabilities the ones available.
 */
export const ComputerRouteSchema = Type.Union([
  Type.Literal('accessibility'),
  Type.Literal('events'),
  Type.Literal('menu'),
  Type.Literal('script'),
  Type.Literal('cdp'),
]);
export type ComputerRoute = Static<typeof ComputerRouteSchema>;
