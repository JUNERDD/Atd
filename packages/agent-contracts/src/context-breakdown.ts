import { Type, type Static } from 'typebox';

/**
 * What fills a task's context, by the part of the request it comes from:
 *
 * - `systemPrompt`: the service prompt's sections other than the skill catalog;
 * - `skills`: the skill catalog section plus the skills loaded into the conversation;
 * - `systemTools`: the declarations of the service's own tools;
 * - `mcpTools`: the declarations of MCP server tools (`mcp__<server>__<tool>`);
 * - `messages`: everything else the provider counted, the conversation itself.
 */
export const ContextCategoryIdSchema = Type.Union([
  Type.Literal('messages'),
  Type.Literal('systemPrompt'),
  Type.Literal('skills'),
  Type.Literal('systemTools'),
  Type.Literal('mcpTools'),
]);
export type ContextCategoryId = Static<typeof ContextCategoryIdSchema>;

/**
 * One named part of a category: one of the service's own tools, an MCP server's tools, or one
 * loaded skill.
 */
export const ContextBreakdownItemSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 512 }),
    tokens: Type.Integer({ minimum: 0 }),
    /** Tools of an MCP server; null where counting has no meaning. */
    count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type ContextBreakdownItem = Static<typeof ContextBreakdownItemSchema>;

export const ContextBreakdownCategorySchema = Type.Object(
  {
    id: ContextCategoryIdSchema,
    tokens: Type.Integer({ minimum: 0 }),
    /** Tools or skills the category holds; null for `messages` and `systemPrompt`. */
    count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /** Largest first; empty without named parts (always for `messages` and `systemPrompt`). */
    items: Type.Array(ContextBreakdownItemSchema),
  },
  { additionalProperties: false },
);
export type ContextBreakdownCategory = Static<typeof ContextBreakdownCategorySchema>;

/**
 * A task's context usage split by category, computed on request from its session (live or read
 * from its session file). Category sizes are estimates (about four characters per token);
 * `usedTokens` is the usage the context ring shows when known, and the categories always sum to
 * it: `messages` takes what the estimated overhead leaves, and the overhead is scaled down when it
 * alone exceeds the usage. `autocompactBuffer` is the reserve the service compacts into
 * (`compactionPolicy`), trimmed so used + buffer never exceeds the window.
 */
export const ContextBreakdownSchema = Type.Object(
  {
    contextWindow: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    usedTokens: Type.Integer({ minimum: 0 }),
    /** True when no provider usage was known, so `usedTokens` itself is an estimate. */
    estimated: Type.Boolean(),
    autocompactBuffer: Type.Integer({ minimum: 0 }),
    /** In `ContextCategoryId` order, every category present, zero-sized ones included. */
    categories: Type.Array(ContextBreakdownCategorySchema),
  },
  { additionalProperties: false },
);
export type ContextBreakdown = Static<typeof ContextBreakdownSchema>;

/** `GET /v1/tasks/:taskId/context`. */
export const ContextBreakdownResponseSchema = Type.Object(
  { breakdown: ContextBreakdownSchema },
  { additionalProperties: false },
);
export type ContextBreakdownResponse = Static<typeof ContextBreakdownResponseSchema>;
