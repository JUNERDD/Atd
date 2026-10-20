import { Type, type Static } from 'typebox';

/** An installed application named by the user; a mention grants no computer access. */
export const ApplicationReferenceSchema = Type.Object(
  {
    kind: Type.Literal('application'),
    bundleId: Type.String({ minLength: 1, maxLength: 255 }),
    name: Type.String({ minLength: 1, maxLength: 255 }),
  },
  { additionalProperties: false },
);
export type ApplicationReference = Static<typeof ApplicationReferenceSchema>;
