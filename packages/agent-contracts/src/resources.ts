import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/** Uploaded bytes addressable by the runner; binaries never ride the WS stream. */
export const ResourceRefSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ maxLength: 255 }),
    size: Type.Integer({ minimum: 0 }),
    mime: Type.String({ maxLength: 100 }),
    taskId: Type.Union([Identifier, Type.Null()]),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
export type ResourceRef = Static<typeof ResourceRefSchema>;
