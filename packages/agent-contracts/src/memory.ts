import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * T6b (service v1.2 candidate): live memory management DTOs over the D7
 * authority singleton. Reads and updates go through Hermes; pause flips the
 * learning gate and bumps the policy version runners gate on.
 */

export const MemoryTargetSchema = Type.Union([
  Type.Literal('memory'),
  Type.Literal('user'),
  Type.Literal('failure'),
]);
export type MemoryTarget = Static<typeof MemoryTargetSchema>;

export const MemoryEntrySchema = Type.Object(
  {
    id: Identifier,
    target: MemoryTargetSchema,
    content: Type.String({ minLength: 1, maxLength: 20000 }),
  },
  { additionalProperties: false },
);
export type MemoryEntry = Static<typeof MemoryEntrySchema>;

export const MemoryListResponseSchema = Type.Object(
  {
    entries: Type.Array(MemoryEntrySchema),
    paused: Type.Boolean(),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryListResponse = Static<typeof MemoryListResponseSchema>;

export const MemoryPauseRequestSchema = Type.Object(
  {
    paused: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type MemoryPauseRequest = Static<typeof MemoryPauseRequestSchema>;

export const MemoryPauseResponseSchema = Type.Object(
  {
    paused: Type.Boolean(),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryPauseResponse = Static<typeof MemoryPauseResponseSchema>;

/** Content may be empty (clears the entry); identity must match a live entry. */
export const MemoryUpdateRequestSchema = Type.Object(
  {
    entry: Type.Object(
      {
        id: Identifier,
        target: MemoryTargetSchema,
      },
      { additionalProperties: false },
    ),
    content: Type.String({ maxLength: 20000 }),
  },
  { additionalProperties: false },
);
export type MemoryUpdateRequest = Static<typeof MemoryUpdateRequestSchema>;

export const MemoryUpdateResponseSchema = Type.Object(
  {
    ok: Type.Literal(true),
    version: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type MemoryUpdateResponse = Static<typeof MemoryUpdateResponseSchema>;
