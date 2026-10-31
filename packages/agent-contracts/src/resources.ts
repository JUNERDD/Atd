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
 * The file a shared attachment was read from: its real path and its version when it was read
 * (`stat` size, modification and change times, inode; a tool that restores the modification time
 * still changes the change time). Service-side only, never sent to a client.
 */
export const ResourceSourceSchema = Type.Object(
  {
    path: Type.String({ minLength: 1, maxLength: 4096 }),
    size: Type.Integer({ minimum: 0 }),
    mtimeMs: Type.Number(),
    ctimeMs: Type.Number(),
    ino: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ResourceSource = Static<typeof ResourceSourceSchema>;

/**
 * A resource as the service ledger keeps it: its `ResourceRef` plus fields clients never see. A
 * shared attachment keeps the SHA-256 of its bytes, by which a later import of the same content
 * reuses it, and its `source` when it was read from a path, which a run sent later reads again once
 * it changed. `touchedAt` is when an import last handed it out again; garbage collection counts
 * its grace period from then, else from `createdAt`. Rows stored before these fields have none.
 */
export const StoredResourceSchema = Type.Object(
  {
    ...ResourceRefSchema.properties,
    sha256: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
    source: Type.Optional(ResourceSourceSchema),
    touchedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type StoredResource = Static<typeof StoredResourceSchema>;

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
 * Why a path was not imported, for the client's own wording: the file could not be read, it is
 * not a regular file, or it is larger than `MAX_ATTACHMENT_BYTES`. Every format is attachable.
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
