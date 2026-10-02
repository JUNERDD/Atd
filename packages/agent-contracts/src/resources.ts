import { Type, type Static } from 'typebox';
import { MAX_ATTACHMENTS } from './attachments.js';
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

/**
 * POST `/v1/resources/import`, reachable only by the shell: it turns paths the user picked,
 * dropped or pasted into resources. Each path must be absolute; the service applies the
 * attachment rules to the file it resolves to.
 */
export const ResourceImportRequestSchema = Type.Object(
  {
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
      minItems: 1,
      maxItems: MAX_ATTACHMENTS,
    }),
  },
  { additionalProperties: false },
);
export type ResourceImportRequest = Static<typeof ResourceImportRequestSchema>;

/**
 * Why a path was not imported, for the client's own wording: the file could not be read,
 * its format is not attachable, or it is not a regular file within `attachmentByteLimit`.
 */
export const ResourceImportFailureReasonSchema = Type.Union([
  Type.Literal('unreadable'),
  Type.Literal('unsupported'),
  Type.Literal('tooLarge'),
]);
export type ResourceImportFailureReason = Static<typeof ResourceImportFailureReasonSchema>;

/** Every requested path lands in exactly one list; both keep request order. */
export const ResourceImportResponseSchema = Type.Object(
  {
    imported: Type.Array(
      Type.Object(
        { path: Type.String(), resource: ResourceRefSchema },
        { additionalProperties: false },
      ),
    ),
    failures: Type.Array(
      Type.Object(
        {
          path: Type.String(),
          reason: ResourceImportFailureReasonSchema,
          /** English explanation naming only the file's basename. */
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ResourceImportResponse = Static<typeof ResourceImportResponseSchema>;
