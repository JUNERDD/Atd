import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T3 skills v1 (UNFROZEN proposal). Additive-only schemas for the controlled
 * skill profile; frozen task/http/ledger contracts are untouched. T34int owns
 * the export lines in `index.ts` and the route mounts.
 */

/** Skill name alphabet: Pi skill directory names constrained to this set. */
export const SkillName = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
});
export type SkillNameType = Static<typeof SkillName>;

/**
 * Where the skill content came from. `local`, `npm`, and `git` resolve under
 * the service dir. `atd` is a live entry from `~/.atd/skills`. `agents` is a
 * live entry from the real `~/.agents/skills`. Install requests stay
 * `local` | `npm` | `git` only.
 */
export const SkillSourceKindSchema = Type.Union([
  Type.Literal('local'),
  Type.Literal('npm'),
  Type.Literal('git'),
  Type.Literal('atd'),
  Type.Literal('agents'),
]);
export type SkillSourceKind = Static<typeof SkillSourceKindSchema>;

/** Tools a script skill may request; text skills request none. */
export const SkillToolSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('write'),
  Type.Literal('edit'),
  Type.Literal('bash'),
  Type.Literal('command'),
]);
export type SkillTool = Static<typeof SkillToolSchema>;

/** Reference frozen at run acceptance; revision pins the immutable content. */
export const SkillRefSchema = Type.Object(
  {
    name: SkillName,
    revision: Type.Optional(Identifier),
  },
  { additionalProperties: false },
);
export type SkillRef = Static<typeof SkillRefSchema>;

/** Text skills carry instructions only; script skills declare needed tools. */
export const SkillCapabilitySchema = Type.Object(
  {
    kind: Type.Union([Type.Literal('text'), Type.Literal('script')]),
    tools: Type.Array(SkillToolSchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);
export type SkillCapability = Static<typeof SkillCapabilitySchema>;

/** Immutable installed revision; runs pin one, updates publish the next. */
export const SkillRevisionSchema = Type.Object(
  {
    name: SkillName,
    revision: Identifier,
    source: Type.String({ minLength: 1, maxLength: 2048 }),
    sourceKind: SkillSourceKindSchema,
    hash: Type.String({ minLength: 1, maxLength: 256 }),
    license: Type.String({ maxLength: 512 }),
    /**
     * Absolute SKILL.md path. Installed skills stay inside the service profile.
     * `atd` entries point at `~/.atd/skills`; `agents` entries point at the
     * real `~/.agents/skills` file.
     */
    entry: Type.String({ minLength: 1, maxLength: 4096 }),
    baseDir: Type.String({ minLength: 1, maxLength: 4096 }),
    description: Type.String({ maxLength: 2048 }),
    disableModelInvocation: Type.Boolean(),
    capability: SkillCapabilitySchema,
    installedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type SkillRevision = Static<typeof SkillRevisionSchema>;

/** Machine-readable skill diagnostic; mirrors Pi collision/invalid shapes. */
export const SkillDiagnosticSchema = Type.Object(
  {
    type: Type.Union([Type.Literal('warning'), Type.Literal('error'), Type.Literal('collision')]),
    code: Type.Union([
      Type.Literal('same_name'),
      Type.Literal('invalid_ref'),
      Type.Literal('invalid_skill'),
      Type.Literal('missing_package'),
      Type.Literal('update_available'),
      Type.Literal('stale_revision'),
      Type.Literal('not_run_available'),
      Type.Literal('capability_denied'),
      Type.Literal('harness_disabled'),
    ]),
    message: Type.String(),
    skill: Type.Optional(SkillName),
    path: Type.Optional(Type.String({ maxLength: 4096 })),
    winnerPath: Type.Optional(Type.String({ maxLength: 4096 })),
    loserPath: Type.Optional(Type.String({ maxLength: 4096 })),
  },
  { additionalProperties: false },
);
export type SkillDiagnostic = Static<typeof SkillDiagnosticSchema>;

/** Upper bound on the skills one run requests; the composer dedupes chips before staging. */
export const MAX_RUN_SKILLS = 32;

/** Frozen per run: requested refs plus the pinned revisions they resolved to. */
export const SkillSnapshotSchema = Type.Object(
  {
    revision: Identifier,
    frozenAt: Type.String(),
    requested: Type.Array(SkillRefSchema, { maxItems: MAX_RUN_SKILLS }),
    skills: Type.Array(SkillRevisionSchema, { maxItems: MAX_RUN_SKILLS }),
    diagnostics: Type.Array(SkillDiagnosticSchema, { maxItems: 64 }),
    /**
     * Skills in `skills` loaded only because a requested skill declares them in
     * `companion-skills`, each with the skill that declared it. Absent in snapshots frozen before
     * companions existed.
     */
    companions: Type.Optional(
      Type.Array(Type.Object({ name: SkillName, of: SkillName }, { additionalProperties: false }), {
        maxItems: MAX_RUN_SKILLS,
      }),
    ),
  },
  { additionalProperties: false },
);
export type SkillSnapshot = Static<typeof SkillSnapshotSchema>;

/**
 * Where a built-in resource's user copy stands against the version this build ships:
 * `modified` — the user edited the shipped content; `update_available` — the user's copy is based
 * on other content than what ships now (or its base is unknown). `version` is the shipped version.
 */
export const BuiltinStatusSchema = Type.Object(
  {
    id: Type.String({ pattern: '^(skill|role):[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' }),
    version: Type.Integer({ minimum: 1 }),
    status: Type.Union([
      Type.Literal('current'),
      Type.Literal('modified'),
      Type.Literal('update_available'),
    ]),
  },
  { additionalProperties: false },
);
export type BuiltinStatus = Static<typeof BuiltinStatusSchema>;

/** Run-available skill row for discovery; never includes non-pinned content. */
export const SkillListItemSchema = Type.Object(
  {
    name: SkillName,
    revision: Identifier,
    description: Type.String({ maxLength: 2048 }),
    sourceKind: SkillSourceKindSchema,
    /** A product skill the service seeds into ~/.atd/skills and restores when deleted. */
    system: Type.Boolean(),
    disableModelInvocation: Type.Boolean(),
    /** Harness gate. False keeps the skill out of runs without editing its files. */
    enabled: Type.Boolean(),
    capability: SkillCapabilitySchema,
    /** Built-in version status of a product skill; null for every other row. */
    builtin: Type.Union([BuiltinStatusSchema, Type.Null()]),
  },
  { additionalProperties: false },
);
export type SkillListItem = Static<typeof SkillListItemSchema>;

export const SkillListResponseSchema = Type.Object(
  {
    revision: Identifier,
    skills: Type.Array(SkillListItemSchema, { maxItems: 500 }),
    diagnostics: Type.Array(SkillDiagnosticSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type SkillListResponse = Static<typeof SkillListResponseSchema>;

/** Turns a catalog skill on or off for this harness. The skill directory is not written. */
export const SkillHarnessRequestSchema = Type.Object(
  {
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type SkillHarnessRequest = Static<typeof SkillHarnessRequestSchema>;

export const SkillInstallRequestSchema = Type.Object(
  {
    source: Type.String({ minLength: 1, maxLength: 2048 }),
    sourceKind: Type.Union([Type.Literal('local'), Type.Literal('npm'), Type.Literal('git')]),
    name: Type.Optional(SkillName),
  },
  { additionalProperties: false },
);
export type SkillInstallRequest = Static<typeof SkillInstallRequestSchema>;

export const SkillInstallResponseSchema = Type.Object(
  {
    skill: SkillRevisionSchema,
    diagnostics: Type.Array(SkillDiagnosticSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type SkillInstallResponse = Static<typeof SkillInstallResponseSchema>;

export const SkillUpdateRequestSchema = Type.Object(
  {
    name: SkillName,
  },
  { additionalProperties: false },
);
export type SkillUpdateRequest = Static<typeof SkillUpdateRequestSchema>;

/** Empty snapshot for runs that requested no skills; preserves T1/T2 behavior. */
export function emptySkillSnapshot(): SkillSnapshot {
  return {
    revision: 'rev-empty',
    frozenAt: new Date(0).toISOString(),
    requested: [],
    skills: [],
    diagnostics: [],
  };
}
