import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { MemoryTargetSchema } from './memory.js';

/**
 * Skill-shaped memory units (docs/plans/2026-10-04-skill-shaped-memory.md). Each memory is one
 * `MEMORY.md` with frontmatter under the service's agent dir; the service's memory authority is
 * its only writer. `MemoryTargetSchema` doubles as the unit's type, so `@` chips and apps keep
 * their labels.
 */

/** The optional category of a unit, Hermes's failure categories. */
export const MemoryCategorySchema = Type.Union([
  Type.Literal('failure'),
  Type.Literal('correction'),
  Type.Literal('insight'),
  Type.Literal('preference'),
  Type.Literal('convention'),
  Type.Literal('tool-quirk'),
]);
export type MemoryCategory = Static<typeof MemoryCategorySchema>;

/**
 * How an enabled unit reaches runs: `core` puts it in every run's prompt, `index` lists its name
 * and description in the run's memory index and loads the body on request, `search` leaves it to
 * the memory search tool.
 */
export const MemoryActivationSchema = Type.Union([
  Type.Literal('core'),
  Type.Literal('index'),
  Type.Literal('search'),
]);
export type MemoryActivation = Static<typeof MemoryActivationSchema>;

/** Who wrote the unit: the user in Settings, the agent through a tool, a learner, or an app. */
export const MemorySourceSchema = Type.Union([
  Type.Literal('user'),
  Type.Literal('agent'),
  Type.Literal('learned'),
  Type.Literal('app'),
]);
export type MemorySource = Static<typeof MemorySourceSchema>;

/** The task and run a unit or proposal came from, and what wrote it (a tool or learner trigger). */
export const MemoryOriginSchema = Type.Object(
  {
    taskId: Identifier,
    runId: Identifier,
    trigger: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { additionalProperties: false },
);
export type MemoryOrigin = Static<typeof MemoryOriginSchema>;

/** A unit's name: the Agent Skills name rule, unique among units. */
export const MemoryNameSchema = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
});

export const MemoryDescriptionSchema = Type.String({ minLength: 1, maxLength: 300 });
export const MemoryBodySchema = Type.String({ minLength: 1, maxLength: 20000 });

/**
 * One memory as Settings show it. `id` never changes; `revision` (a digest of the saved file)
 * guards saves against a concurrent change. `reviewed` is false for a learned unit the user has
 * not opened yet.
 */
export const MemoryUnitSchema = Type.Object(
  {
    id: Identifier,
    name: MemoryNameSchema,
    description: MemoryDescriptionSchema,
    type: MemoryTargetSchema,
    category: Type.Union([MemoryCategorySchema, Type.Null()]),
    activation: MemoryActivationSchema,
    enabled: Type.Boolean(),
    source: MemorySourceSchema,
    origin: Type.Union([MemoryOriginSchema, Type.Null()]),
    reviewed: Type.Boolean(),
    created: Type.String({ minLength: 1, maxLength: 64 }),
    updated: Type.String({ minLength: 1, maxLength: 64 }),
    body: MemoryBodySchema,
    revision: Type.String({ minLength: 1, maxLength: 128 }),
  },
  { additionalProperties: false },
);
export type MemoryUnit = Static<typeof MemoryUnitSchema>;

/**
 * A learner suggestion waiting for the user: remove a unit, make one `core`, create a Personal
 * skill from a learned procedure, or (with Ask before saving on) create or update a unit.
 */
export const MemoryProposalKindSchema = Type.Union([
  Type.Literal('create'),
  Type.Literal('update'),
  Type.Literal('remove'),
  Type.Literal('core'),
  Type.Literal('skill'),
]);
export type MemoryProposalKind = Static<typeof MemoryProposalKindSchema>;

export const MemoryProposalSchema = Type.Object(
  {
    id: Identifier,
    kind: MemoryProposalKindSchema,
    /** The unit it acts on; null for `create` and `skill`. */
    unitId: Type.Union([Identifier, Type.Null()]),
    /** The unit's name, or the proposed unit or skill name. */
    name: MemoryNameSchema,
    description: Type.String({ maxLength: 300 }),
    /** The proposed body (unit body, or SKILL.md body for `skill`); empty when none applies. */
    body: Type.String({ maxLength: 20000 }),
    type: Type.Union([MemoryTargetSchema, Type.Null()]),
    /** The proposed unit's category (`create`), carried through on accept. */
    category: Type.Union([MemoryCategorySchema, Type.Null()]),
    /**
     * The unit's revision when the proposal was made (`update`, `remove`, `core`); accepting after
     * the unit changed answers 409 instead of overwriting the newer version. Null otherwise.
     */
    revision: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    reason: Type.String({ maxLength: 1000 }),
    created: Type.String({ minLength: 1, maxLength: 64 }),
    origin: Type.Union([MemoryOriginSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type MemoryProposal = Static<typeof MemoryProposalSchema>;

/** A unit file that could not be read; it stays out of runs until fixed or removed. */
export const MemoryProblemSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    message: Type.String({ minLength: 1, maxLength: 2000 }),
  },
  { additionalProperties: false },
);
export type MemoryProblem = Static<typeof MemoryProblemSchema>;

/** `GET /v1/memory`: every unit in Settings order, pending proposals, and the learning settings. */
export const MemoryStateResponseSchema = Type.Object(
  {
    units: Type.Array(MemoryUnitSchema),
    proposals: Type.Array(MemoryProposalSchema),
    problems: Type.Array(MemoryProblemSchema),
    paused: Type.Boolean(),
    askFirst: Type.Boolean(),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryStateResponse = Static<typeof MemoryStateResponseSchema>;

/** `POST /v1/memory/settings`: pause learning, or route every learner write to proposals. */
export const MemorySettingsRequestSchema = Type.Object(
  {
    paused: Type.Optional(Type.Boolean()),
    askFirst: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type MemorySettingsRequest = Static<typeof MemorySettingsRequestSchema>;

export const MemorySettingsResponseSchema = Type.Object(
  {
    paused: Type.Boolean(),
    askFirst: Type.Boolean(),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemorySettingsResponse = Static<typeof MemorySettingsResponseSchema>;

/** `POST /v1/memory/create`: a unit written in Settings; a missing name is derived and made unique. */
export const MemoryCreateRequestSchema = Type.Object(
  {
    name: Type.Optional(MemoryNameSchema),
    description: MemoryDescriptionSchema,
    type: MemoryTargetSchema,
    category: Type.Optional(Type.Union([MemoryCategorySchema, Type.Null()])),
    activation: Type.Optional(MemoryActivationSchema),
    body: MemoryBodySchema,
  },
  { additionalProperties: false },
);
export type MemoryCreateRequest = Static<typeof MemoryCreateRequestSchema>;

/** `POST /v1/memory/save`: changes the given fields; a stale `revision` answers 409. */
export const MemorySaveRequestSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.String({ minLength: 1, maxLength: 128 }),
    name: Type.Optional(MemoryNameSchema),
    description: Type.Optional(MemoryDescriptionSchema),
    type: Type.Optional(MemoryTargetSchema),
    category: Type.Optional(Type.Union([MemoryCategorySchema, Type.Null()])),
    activation: Type.Optional(MemoryActivationSchema),
    body: Type.Optional(MemoryBodySchema),
  },
  { additionalProperties: false },
);
export type MemorySaveRequest = Static<typeof MemorySaveRequestSchema>;

export const MemoryUnitResponseSchema = Type.Object(
  {
    unit: MemoryUnitSchema,
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryUnitResponse = Static<typeof MemoryUnitResponseSchema>;

/**
 * Names one unit or proposal: `POST /v1/memory/delete` (moves the unit to the trash),
 * `/reviewed` (clears its New badge), `/proposals/accept` and `/proposals/dismiss`.
 */
export const MemoryIdRequestSchema = Type.Object(
  {
    id: Identifier,
  },
  { additionalProperties: false },
);
export type MemoryIdRequest = Static<typeof MemoryIdRequestSchema>;

/** `POST /v1/memory/enable`: turns one unit on or off for runs. */
export const MemoryToggleRequestSchema = Type.Object(
  {
    id: Identifier,
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type MemoryToggleRequest = Static<typeof MemoryToggleRequestSchema>;

export const MemoryOkResponseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryOkResponse = Static<typeof MemoryOkResponseSchema>;

/** Accepting a `skill` proposal creates that Personal skill and answers its name. */
export const MemoryProposalAcceptResponseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    version: Type.Integer({ minimum: 0 }),
    skill: Type.Union([
      Type.Object({ name: Type.String({ minLength: 1, maxLength: 128 }) }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
export type MemoryProposalAcceptResponse = Static<typeof MemoryProposalAcceptResponseSchema>;
