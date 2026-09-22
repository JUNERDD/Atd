import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { SkillName, SkillToolSchema } from './skills.js';

/**
 * T3 roles v1 (UNFROZEN proposal). Roles bound what a run may use; Skill/MCP
 * annotations and profile text grant nothing. Additive-only; T34int owns the
 * export lines in `index.ts`.
 */

/** Managed role id; service user profile only, no exec-dir overrides. */
export const RoleId = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$',
});
export type RoleIdType = Static<typeof RoleId>;

/** What a role allows; the run snapshot intersects with this at freeze time. */
export const RoleAllowsSchema = Type.Object(
  {
    tools: Type.Array(SkillToolSchema, { maxItems: 16 }),
    skills: Type.Array(SkillName, { maxItems: 128 }),
  },
  { additionalProperties: false },
);
export type RoleAllows = Static<typeof RoleAllowsSchema>;

/** Managed role definition; revisions are immutable once published. */
export const RoleDefinitionSchema = Type.Object(
  {
    id: RoleId,
    revision: Identifier,
    title: Type.String({ minLength: 1, maxLength: 256 }),
    allows: RoleAllowsSchema,
    updatedAt: Type.String(),
  },
  { additionalProperties: false },
);
export type RoleDefinition = Static<typeof RoleDefinitionSchema>;

/** Frozen per run; later role edits never mutate an accepted snapshot. */
export const RoleSnapshotSchema = Type.Object(
  {
    roleId: RoleId,
    revision: Identifier,
    allows: RoleAllowsSchema,
    frozenAt: Type.String(),
  },
  { additionalProperties: false },
);
export type RoleSnapshot = Static<typeof RoleSnapshotSchema>;

/**
 * Effective run capabilities: run request ∩ role allows ∩ service revocation.
 * Skill/MCP annotations and profile text are inputs to this computation and
 * never grant capabilities by themselves.
 */
export const CapabilitySnapshotSchema = Type.Object(
  {
    runId: Identifier,
    roleId: RoleId,
    roleRevision: Identifier,
    tools: Type.Array(SkillToolSchema, { maxItems: 16 }),
    skills: Type.Array(SkillName, { maxItems: 128 }),
    revokedTools: Type.Array(SkillToolSchema, { maxItems: 16 }),
    revokedSkills: Type.Array(SkillName, { maxItems: 128 }),
    frozenAt: Type.String(),
  },
  { additionalProperties: false },
);
export type CapabilitySnapshot = Static<typeof CapabilitySnapshotSchema>;

export const RoleListResponseSchema = Type.Object(
  {
    roles: Type.Array(RoleDefinitionSchema, { maxItems: 128 }),
  },
  { additionalProperties: false },
);
export type RoleListResponse = Static<typeof RoleListResponseSchema>;

/** Intersects requested tools with role allows minus revoked tools. */
export function intersectTools(requested: string[], allows: string[], revoked: string[]): string[] {
  const allow = new Set(allows);
  const denied = new Set(revoked);
  return requested.filter((tool) => allow.has(tool) && !denied.has(tool));
}

/** Intersects requested skills with role allows minus revoked skills. */
export function intersectSkills(
  requested: string[],
  allows: string[],
  revoked: string[],
): string[] {
  const allow = new Set(allows);
  const denied = new Set(revoked);
  return requested.filter((skill) => allow.has(skill) && !denied.has(skill));
}

/** Default role: everyday writing/analysis tools, no skill allowlist widening. */
export function defaultRoleAllows(): RoleAllows {
  return { tools: ['read', 'write', 'edit', 'bash', 'command'], skills: [] };
}
