import { Type, type Static } from 'typebox';
import {
  ComputerDeliverySchema,
  ComputerEffectSchema,
  ComputerHashSchema,
  ComputerRefIdSchema,
  ComputerRouteSchema,
  ComputerStepKindSchema,
  ComputerUrlSchema,
  type ComputerStepKind,
} from './computer-actions.js';
import { Identifier } from './identifiers.js';

/**
 * Targets of the `computer` tool: the service-owned bindings a person registered (the durable
 * authorization subject) and the runtime refs a host resolves them to for one host generation.
 * A PID, a window title or an arbitrary CDP URL is never a lasting authorization; only a binding's
 * `bindingId` with its `revision` and `hash` is.
 */

/** Bindings one run, automation or status listing may name. */
export const COMPUTER_MAX_RUN_BINDINGS = 8;
export const COMPUTER_MAX_BINDINGS = 50;

/**
 * The engines a host drives: `playwright` (playwright-core attached over CDP) for managed browser
 * profiles, `atd` (the app's own background driver, built in) for native apps. Each target kind
 * has exactly one engine (`COMPUTER_ENGINE_FOR_KIND`); code that branches on an engine reads it
 * from that table rather than naming a literal.
 */
export const ComputerEngineSchema = Type.Union([Type.Literal('playwright'), Type.Literal('atd')]);
export type ComputerEngine = Static<typeof ComputerEngineSchema>;

export const ComputerTargetKindSchema = Type.Union([
  Type.Literal('browser'),
  Type.Literal('native'),
]);
export type ComputerTargetKind = Static<typeof ComputerTargetKindSchema>;

export const COMPUTER_ENGINE_FOR_KIND: Readonly<Record<ComputerTargetKind, ComputerEngine>> = {
  browser: 'playwright',
  native: 'atd',
};

/** The step kinds each target kind supports at most; a host profile may publish fewer. */
export const COMPUTER_STEP_KINDS_FOR_KIND: Readonly<
  Record<ComputerTargetKind, readonly ComputerStepKind[]>
> = {
  browser: ['navigate', 'fill', 'press', 'scroll', 'wait', 'clear', 'key', 'select', 'upload'],
  native: ['setValue', 'press', 'wait', 'click', 'key', 'type', 'clear', 'menu', 'scroll', 'drag'],
};

/** An http(s) origin, `scheme://host[:port]`, with no path, query or fragment. */
export const ComputerOriginSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: '^https?://[^/?#\\s]+$',
});

/** What a browser binding stores beside its identity; part of its `hash`. */
const browserFields = {
  kind: Type.Literal('browser'),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  /** The host-managed browser profile the person signed in to; never their own browser profile. */
  profileId: Identifier,
  /** Origins navigation and actions may reach; `navigate` URLs outside them are refused. */
  allowedOrigins: Type.Array(ComputerOriginSchema, {
    minItems: 1,
    maxItems: 20,
    uniqueItems: true,
  }),
  startUrl: ComputerUrlSchema,
  /** Which page of the profile is the target: the first whose URL starts with `urlPrefix`. */
  pageRule: Type.Object({ urlPrefix: ComputerUrlSchema }, { additionalProperties: false }),
};

const AbsolutePath = Type.String({ minLength: 2, maxLength: 4096, pattern: '^/' });

/**
 * What a native binding stores beside its identity; part of its `hash`. The target is an
 * application: the host picked the app and checked its install location (`appPath`) and, when
 * signed, its team. Documents are never targets; the agent edits files with its file tools.
 */
const nativeFields = {
  kind: Type.Literal('native'),
  label: Type.String({ minLength: 1, maxLength: 120 }),
  bundleId: Type.String({ minLength: 1, maxLength: 255 }),
  appName: Type.String({ minLength: 1, maxLength: 255 }),
  appPath: AbsolutePath,
  teamId: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
};

const identityFields = {
  bindingId: Identifier,
  /** Bumped with `hash` on every content change, which invalidates grants that name the binding. */
  revision: Type.Integer({ minimum: 1 }),
  /** SHA-256 of the binding's content fields (everything but identity) over `canonicalJson`. */
  hash: ComputerHashSchema,
};

/**
 * A registered target, owned by the service (`<dataDir>/computer/bindings.json`). Created and
 * updated only from a host-prepared target through the shell-only bindings route; the agent and
 * the renderer can list and delete bindings but never write their content.
 */
export const TargetBindingSchema = Type.Union([
  Type.Object({ ...identityFields, ...browserFields }, { additionalProperties: false }),
  Type.Object({ ...identityFields, ...nativeFields }, { additionalProperties: false }),
]);
export type TargetBinding = Static<typeof TargetBindingSchema>;

/** A binding's content without its identity: what the host prepares and the service hashes. */
export const TargetBindingContentSchema = Type.Union([
  Type.Object(browserFields, { additionalProperties: false }),
  Type.Object(nativeFields, { additionalProperties: false }),
]);
export type TargetBindingContent = Static<typeof TargetBindingContentSchema>;

/**
 * Locator kinds a target action accepts: an element ref, a semantic description, or a capture
 * point.
 */
export const ComputerLocateKindSchema = Type.Union([
  Type.Literal('element'),
  Type.Literal('semantic'),
  Type.Literal('image'),
]);
export type ComputerLocateKind = Static<typeof ComputerLocateKindSchema>;

/**
 * What one target supports for one step kind right now, as the host resolved it: the locator
 * kinds and deliveries it accepts (empty `delivery`: unavailable on this target), the background
 * routes the host can take for it here (`routes`; absent when the host does not say) and whether
 * that combination was `verified` on this target. The usable set is the intersection of the
 * engine profile, these capabilities and what the run allows.
 */
export const TargetCapabilitySchema = Type.Object(
  {
    action: ComputerStepKindSchema,
    locate: Type.Array(ComputerLocateKindSchema, { maxItems: 3, uniqueItems: true }),
    delivery: Type.Array(ComputerDeliverySchema, { maxItems: 2, uniqueItems: true }),
    routes: Type.Optional(Type.Array(ComputerRouteSchema, { maxItems: 6, uniqueItems: true })),
    verified: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TargetCapability = Static<typeof TargetCapabilitySchema>;

/**
 * A binding resolved by one host generation. Opaque to the model, which only passes `id` back;
 * every host or engine restart resolves bindings again and invalidates older refs. `browser` is
 * set for `playwright` targets and `native` for `atd` targets, whose `windowId` is the root window
 * the host resolved for the application (its main window, else its focused window, else its
 * frontmost one); the app's other top-level windows are surfaces of the target.
 */
export const TargetRefSchema = Type.Object(
  {
    id: ComputerRefIdSchema,
    bindingId: Identifier,
    bindingRevision: Type.Integer({ minimum: 1 }),
    hostGeneration: Type.Integer({ minimum: 1 }),
    engine: ComputerEngineSchema,
    engineGeneration: Type.Integer({ minimum: 1 }),
    browser: Type.Optional(
      Type.Object(
        {
          profileId: Identifier,
          contextId: ComputerRefIdSchema,
          pageId: ComputerRefIdSchema,
          /** Bumped by the host on each top-level navigation; observations name the one they saw. */
          navigationGeneration: Type.Integer({ minimum: 0 }),
        },
        { additionalProperties: false },
      ),
    ),
    native: Type.Optional(
      Type.Object(
        {
          pid: Type.Integer({ minimum: 1 }),
          /** The process start identity, so a reused PID never matches an older ref. */
          processStart: Type.String({ minLength: 1, maxLength: 64 }),
          windowId: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    capabilities: Type.Optional(Type.Array(TargetCapabilitySchema, { maxItems: 16 })),
  },
  { additionalProperties: false },
);
export type TargetRef = Static<typeof TargetRefSchema>;

/**
 * What one engine of the connected host can do at most, published by the host in
 * `computer.hello`; the model never claims support itself. `delivery` lists how it delivers
 * (only `background` exists); `affectsSystemInput` says whether that delivery can still move the
 * shared pointer or keyboard focus. Targets narrow this per action (`TargetRef.capabilities`).
 * Only a `qualified` profile may serve unattended runs; `evidence` names the qualification it
 * rests on (test suite and version).
 */
export const CapabilityProfileSchema = Type.Object(
  {
    engine: ComputerEngineSchema,
    engineVersion: Type.String({ minLength: 1, maxLength: 64 }),
    os: Type.String({ minLength: 1, maxLength: 64 }),
    arch: Type.Union([Type.Literal('arm64'), Type.Literal('x86_64')]),
    targetKinds: Type.Array(ComputerTargetKindSchema, {
      minItems: 1,
      maxItems: 2,
      uniqueItems: true,
    }),
    actions: Type.Array(ComputerStepKindSchema, { maxItems: 16, uniqueItems: true }),
    effects: Type.Array(ComputerEffectSchema, { maxItems: 8, uniqueItems: true }),
    delivery: Type.Array(ComputerDeliverySchema, { minItems: 1, maxItems: 2, uniqueItems: true }),
    affectsSystemInput: Type.Boolean(),
    qualification: Type.Union([Type.Literal('qualified'), Type.Literal('unqualified')]),
    evidence: Type.String({ maxLength: 500 }),
  },
  { additionalProperties: false },
);
export type CapabilityProfile = Static<typeof CapabilityProfileSchema>;
