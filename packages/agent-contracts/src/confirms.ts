import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';
import { ShellAllowlistEntrySchema } from './shell.js';

/** Per-task approval tier carried over from the desktop permission model. */
export const PermissionTierSchema = Type.Union([
  Type.Literal('manual'),
  Type.Literal('auto'),
  Type.Literal('always'),
]);
export type PermissionTier = Static<typeof PermissionTierSchema>;
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'manual';

export const GrantLocationSchema = Type.Union([Type.Literal('inside'), Type.Literal('outside')]);
export type GrantLocation = Static<typeof GrantLocationSchema>;

/** Unit a permission decision applies to; session grants reuse the same scope. */
export const GrantScopeSchema = Type.Union([
  Type.Object(
    {
      tool: Type.Union([Type.Literal('read'), Type.Literal('write'), Type.Literal('edit')]),
      location: GrantLocationSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object({ tool: Type.Literal('bash') }, { additionalProperties: false }),
  Type.Object({ tool: Type.Literal('command') }, { additionalProperties: false }),
  // v1.1 additive: MCP per-operation scope. MCP approvals are allow_once/deny
  // only; a `session` answer downgrades to once and is never cached as a grant.
  Type.Object({ tool: Type.Literal('mcp') }, { additionalProperties: false }),
  // C1 additive: every network call of web_search / fetch_content. Session grants apply.
  Type.Object({ tool: Type.Literal('web') }, { additionalProperties: false }),
]);
export type GrantScope = Static<typeof GrantScopeSchema>;

/** Stable identity of a scope, used as the key of the per-session grant set. */
export function grantKey(scope: GrantScope): string {
  return 'location' in scope ? `${scope.tool}:${scope.location}` : scope.tool;
}

export const PermissionOutcomeSchema = Type.Union([
  Type.Literal('once'),
  Type.Literal('session'),
  Type.Literal('grant'),
  Type.Literal('tier'),
  Type.Literal('declined'),
]);
export type PermissionOutcome = Static<typeof PermissionOutcomeSchema>;

/**
 * Pending human-in-the-loop request. `revision` guards replies: a reply whose
 * revision does not match the live request is rejected as stale.
 *
 * C1 additive: a bash `confirmation` may carry `allowlistEntry`, the entry the
 * service suggests adding to the user's shell allowlist (shell.ts); absent when
 * the command has no safe suggestion.
 */
export const PermissionRequestSchema = Type.Union([
  Type.Object(
    {
      id: Identifier,
      revision: Type.Integer({ minimum: 1 }),
      taskId: Identifier,
      runId: Identifier,
      executionId: Type.String({ maxLength: 256 }),
      toolCallId: Type.String({ maxLength: 256 }),
      kind: Type.Literal('confirmation'),
      scope: GrantScopeSchema,
      title: Type.String({ maxLength: 500 }),
      detail: Type.String({ maxLength: 200000 }),
      allowlistEntry: Type.Optional(ShellAllowlistEntrySchema),
      createdAt: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      id: Identifier,
      revision: Type.Integer({ minimum: 1 }),
      taskId: Identifier,
      runId: Identifier,
      executionId: Type.String({ maxLength: 256 }),
      toolCallId: Type.String({ maxLength: 256 }),
      kind: Type.Literal('input'),
      title: Type.String({ maxLength: 4000 }),
      options: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 8 }),
      createdAt: Type.String(),
    },
    { additionalProperties: false },
  ),
]);
export type PermissionRequest = Static<typeof PermissionRequestSchema>;

/**
 * The renderer's reply to a request; the runtime rejects a reply whose shape does not fit the kind.
 * `confirmation` takes a decision (a bash confirm's add-to-allowlist choice adds the entry through
 * the desktop settings first, then answers `once`); `input` takes an answer or a skip.
 */
export const PermissionAnswerSchema = Type.Union([
  Type.Object(
    {
      decision: Type.Union([
        Type.Literal('once'),
        Type.Literal('session'),
        Type.Literal('declined'),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { answer: Type.String({ minLength: 1, maxLength: 10000 }) },
    {
      additionalProperties: false,
    },
  ),
  Type.Object({ skipped: Type.Literal(true) }, { additionalProperties: false }),
]);
export type PermissionAnswer = Static<typeof PermissionAnswerSchema>;

/**
 * Whether a scope is allowed without a prompt under a tier. Reads inside the
 * task folder never prompt: the agent reading its own output is not a decision.
 */
export function tierAllows(tier: PermissionTier, scope: GrantScope): boolean {
  if (tier === 'always') return true;
  if ('location' in scope && scope.tool === 'read' && scope.location === 'inside') return true;
  if (tier === 'manual') return false;
  return 'location' in scope && scope.location === 'inside';
}

/** Desktop-only capabilities a registered client may serve; T6 owns the UI. */
export const DesktopCapabilitySchema = Type.Union([
  Type.Literal('file.pick'),
  Type.Literal('file.save'),
  Type.Literal('selection.read'),
  Type.Literal('clipboard.read'),
  Type.Literal('clipboard.write'),
]);
export type DesktopCapability = Static<typeof DesktopCapabilitySchema>;

/**
 * Request for a desktop capability. Persisted while waiting; late results for a
 * cancelled or expired request are rejected instead of applied.
 */
export const CapabilityRequestSchema = Type.Object(
  {
    id: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    capability: DesktopCapabilitySchema,
    input: Type.Unknown(),
    taskId: Identifier,
    runId: Identifier,
    executionId: Type.String({ maxLength: 256 }),
    operationId: Type.String({ maxLength: 128 }),
    expiresAt: Type.String(),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type CapabilityRequest = Static<typeof CapabilityRequestSchema>;

/** Result delivered by the desktop client for a live capability request. */
export const CapabilityResultSchema = Type.Object(
  {
    requestId: Identifier,
    revision: Type.Integer({ minimum: 1 }),
    ok: Type.Boolean(),
    value: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.String({ maxLength: 2000 })),
  },
  { additionalProperties: false },
);
export type CapabilityResult = Static<typeof CapabilityResultSchema>;
