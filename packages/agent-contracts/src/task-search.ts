import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * `GET /v1/tasks/search`: finds tasks by what was said in their conversations. `query` is matched
 * as whitespace-separated terms, each a case-insensitive substring; a task matches when every term
 * appears in its user or assistant text. Titles and statuses are matched by the client, not here.
 */
export const TaskSearchQuerySchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 200 }),
    /** Most tasks returned; defaults to 100. */
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  },
  { additionalProperties: false },
);
export type TaskSearchQuery = Static<typeof TaskSearchQuerySchema>;

/** A UTF-16 range `[from, to)` of a hit's snippet that matched a term. */
export const TaskSearchRangeSchema = Type.Tuple([
  Type.Integer({ minimum: 0 }),
  Type.Integer({ minimum: 0 }),
]);
export type TaskSearchRange = Static<typeof TaskSearchRangeSchema>;

/**
 * A task's best match: the one message holding the most distinct terms, the earliest on a tie,
 * as a single-line excerpt around the first match with the ranges every term matched in it.
 */
export const TaskSearchHitSchema = Type.Object(
  {
    taskId: Identifier,
    /** Who said the matched message. */
    role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
    snippet: Type.String({ maxLength: 400 }),
    ranges: Type.Array(TaskSearchRangeSchema, { maxItems: 64 }),
  },
  { additionalProperties: false },
);
export type TaskSearchHit = Static<typeof TaskSearchHitSchema>;

/** At most one hit per task, the most recently updated task first. */
export const TaskSearchResponseSchema = Type.Object(
  {
    hits: Type.Array(TaskSearchHitSchema, { maxItems: 200 }),
    /** More tasks matched than `limit` returned. */
    truncated: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TaskSearchResponse = Static<typeof TaskSearchResponseSchema>;
