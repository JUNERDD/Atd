import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Memory shapes shared beyond Settings: a unit's type (`MemoryTargetSchema`, also the `@` chip's
 * target) and the plain entry apps read through their memory capability (`MemoryEntrySchema`, an
 * enabled unit's id, type and body). Settings and the memory routes use the unit DTOs in
 * memory-units.ts.
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
