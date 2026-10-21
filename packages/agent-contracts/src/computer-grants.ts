import { Type, type Static } from 'typebox';
import { ComputerActionIdSchema, ComputerHashSchema } from './computer-actions.js';
import { COMPUTER_MAX_RUN_BINDINGS } from './computer-targets.js';
import { Identifier } from './identifiers.js';

/**
 * Computer authorization: the grants the service writes after a person approves an automation's
 * exact computer scope, the trial runs that qualify it, what a run freezes and the hold that stops
 * further side effects after an unverified one. Agents, prompts, the auto review and the `always`
 * tier never create or widen a grant.
 */

/** Action ids one hold or run record lists. */
export const COMPUTER_MAX_UNRESOLVED = 100;

/** Binding id → that binding's `hash` when the grant (or run) was frozen. */
export const ComputerBindingHashesSchema = Type.Record(Identifier, ComputerHashSchema, {
  maxProperties: COMPUTER_MAX_RUN_BINDINGS,
  additionalProperties: false,
});
export type ComputerBindingHashes = Static<typeof ComputerBindingHashesSchema>;

/** Names one version of a grant; executions carry it and the service checks it live per step. */
export const ComputerGrantRefSchema = Type.Object(
  { grantId: Identifier, version: Type.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
export type ComputerGrantRef = Static<typeof ComputerGrantRefSchema>;

/**
 * A grant (`Automation.computerGrant`): service-written only, never part of a draft, so no save
 * body can carry one. It is valid while every hash still matches the live definition
 * (`definitionHash` covers trigger, action and policy, not name, enabled or revision), recipe,
 * bindings and resolved command, and it is not revoked; any mismatch stops scheduled dispatch and
 * the automation needs authorizing again.
 */
export const ComputerGrantSchema = Type.Object(
  {
    grantId: Identifier,
    version: Type.Integer({ minimum: 1 }),
    definitionHash: ComputerHashSchema,
    recipeHash: ComputerHashSchema,
    bindingHashes: ComputerBindingHashesSchema,
    /** Fingerprint of the command a command action resolved to when approved. */
    commandFingerprint: Type.Optional(ComputerHashSchema),
    /** The passed trial this grant rests on. */
    trialRef: Type.Object(
      { trialId: Identifier, at: Type.String(), engineProfilesHash: ComputerHashSchema },
      { additionalProperties: false },
    ),
    approvedAt: Type.String(),
    revokedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type ComputerGrant = Static<typeof ComputerGrantSchema>;

/**
 * An attended trial of an automation's recipe (`<dataDir>/computer/trials.json`), recorded by the
 * service from host-verified facts only; an agent saying it worked records nothing. A grant can
 * cite only a `passed` trial whose hashes match what is being approved.
 */
export const ComputerTrialSchema = Type.Object(
  {
    trialId: Identifier,
    automationId: Identifier,
    definitionHash: ComputerHashSchema,
    recipeHash: ComputerHashSchema,
    bindingHashes: ComputerBindingHashesSchema,
    /** Hash of the host's capability profiles the trial ran with. */
    engineProfilesHash: ComputerHashSchema,
    result: Type.Union([Type.Literal('passed'), Type.Literal('failed')]),
    runId: Identifier,
    at: Type.String(),
  },
  { additionalProperties: false },
);
export type ComputerTrial = Static<typeof ComputerTrialSchema>;

/**
 * Where the newest trial of the automation's saved computer scope stands
 * (`AutomationStatus.computerTrial`): running, or the outcome the service judged from the trial's
 * facts. A trial of an earlier definition or recipe is not reported.
 */
export const ComputerTrialStateSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('passed'),
  Type.Literal('failed'),
]);
export type ComputerTrialState = Static<typeof ComputerTrialStateSchema>;

/**
 * Why a hold stands: an action whose outcome is unknown, one that took effect only in part, or a
 * person must look (the host found the target in use, the action disturbed the person, or the
 * host reported a state it cannot judge).
 */
export const ComputerHoldReasonSchema = Type.Union([
  Type.Literal('unknownEffect'),
  Type.Literal('partialEffect'),
  Type.Literal('needsHuman'),
]);
export type ComputerHoldReason = Static<typeof ComputerHoldReasonSchema>;

/**
 * Set by the service when a run left unresolved side effects (`AutomationState.computerHold`). It
 * blocks schedule fires, Run now and chained runs with computer writes until a person resolves it
 * through the hold route; reading results, editing or Run now never clear it.
 */
export const ComputerHoldSchema = Type.Object(
  {
    since: Type.String(),
    runId: Identifier,
    unresolvedActionIds: Type.Array(ComputerActionIdSchema, {
      maxItems: COMPUTER_MAX_UNRESOLVED,
    }),
    reason: ComputerHoldReasonSchema,
  },
  { additionalProperties: false },
);
export type ComputerHold = Static<typeof ComputerHoldSchema>;

/** What an unattended run freezes from the grant at enqueue (`RunComputer.grant`). */
export const ComputerRunGrantSchema = Type.Object(
  {
    automationId: Identifier,
    grantId: Identifier,
    version: Type.Integer({ minimum: 1 }),
    recipeHash: ComputerHashSchema,
    bindingHashes: ComputerBindingHashesSchema,
  },
  { additionalProperties: false },
);
export type ComputerRunGrant = Static<typeof ComputerRunGrantSchema>;

const RunBindingIds = Type.Array(Identifier, {
  minItems: 1,
  maxItems: COMPUTER_MAX_RUN_BINDINGS,
  uniqueItems: true,
});

/**
 * Computer use requested for a run (`SubmitTaskRequest.computer`, `CommandRunRequest.computer`):
 * the registered bindings it may act on. Only an attended run accepts it.
 */
export const ComputerRunRequestSchema = Type.Object(
  { bindingIds: RunBindingIds },
  { additionalProperties: false },
);
export type ComputerRunRequest = Static<typeof ComputerRunRequestSchema>;

/**
 * An attended trial of an automation's recipe (`RunComputer.trial`): the run acts only through the
 * recipe whose hash it froze, with a person present, and the service records the outcome as the
 * automation's `ComputerTrial` from the host-verified facts.
 */
export const ComputerRunTrialSchema = Type.Object(
  {
    automationId: Identifier,
    trialId: Identifier,
    definitionHash: ComputerHashSchema,
    recipeHash: ComputerHashSchema,
    bindingHashes: ComputerBindingHashesSchema,
  },
  { additionalProperties: false },
);
export type ComputerRunTrial = Static<typeof ComputerRunTrialSchema>;

/**
 * Computer use frozen onto a run (`RunSnapshot.computer`); the `computer` tool exists only in runs
 * that carry it, and it is part of the session's binding key. Attended runs carry `bindingIds`
 * from the submit (follow-ups copy them); unattended runs also carry `grant`, frozen at enqueue
 * and still checked live per step against the grant store, and a follow-up never inherits it. A
 * trial run carries `trial` instead (never both); a follow-up does not inherit it either. Nothing
 * here selects a delivery: the host picks it per step, and only an attended run with neither
 * `grant` nor `trial` lets it fall back to the foreground (`ExecutionEnvelope.foregroundAllowed`).
 */
export const RunComputerSchema = Type.Object(
  {
    bindingIds: RunBindingIds,
    grant: Type.Optional(ComputerRunGrantSchema),
    trial: Type.Optional(ComputerRunTrialSchema),
  },
  { additionalProperties: false },
);
export type RunComputer = Static<typeof RunComputerSchema>;

/**
 * Durable computer facts of one automation run, summarized for its record
 * (`AutomationRun.computer`): how many actions settled verified, partial or unknown, how many were
 * never dispatched, and which actions are still unresolved.
 */
export const AutomationComputerFactsSchema = Type.Object(
  {
    facts: Type.Object(
      {
        verified: Type.Integer({ minimum: 0 }),
        partial: Type.Integer({ minimum: 0 }),
        unknown: Type.Integer({ minimum: 0 }),
        notDispatched: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    unresolvedActionIds: Type.Array(ComputerActionIdSchema, {
      maxItems: COMPUTER_MAX_UNRESOLVED,
    }),
  },
  { additionalProperties: false },
);
export type AutomationComputerFacts = Static<typeof AutomationComputerFactsSchema>;

/**
 * Computer reasons of an automation run (`AutomationRunReason`): the grant no longer matches,
 * a hold blocked the fire, a bound target cannot be reached, an action's outcome is unknown, or a
 * person must look before anything continues.
 */
export const ComputerRunReasonSchema = Type.Union([
  Type.Literal('computerGrantInvalid'),
  Type.Literal('computerHold'),
  Type.Literal('computerTargetUnavailable'),
  Type.Literal('computerUnknownEffect'),
  Type.Literal('computerNeedsHuman'),
]);

/** Status problems (`AutomationStatus.problem`): authorization is missing or stale, or a hold. */
export const ComputerStatusProblemSchema = Type.Union([
  Type.Literal('computerNeedsAuthorization'),
  Type.Literal('computerHold'),
]);

/**
 * Deterministic JSON for hashing: object keys sorted by code unit at every depth, array order
 * kept, no whitespace. The service hashes this text with SHA-256 for every `*Hash` field, so the
 * shell and service agree byte for byte. Throws on values JSON cannot represent exactly
 * (`undefined` members are dropped as `JSON.stringify` does; non-finite numbers, functions and
 * symbols throw).
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const members = Object.entries(value)
      .filter(([, item]: [string, unknown]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]: [string, unknown]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
}
