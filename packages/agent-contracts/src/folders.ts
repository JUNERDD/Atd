import { Type, type Static } from 'typebox';
import { Identifier } from './identifiers.js';

/**
 * Folders a task may read: the user hands a directory to the app (drop, Finder service, open
 * panel), the shell registers it with the service, and a submit grants the registered folder to
 * its task. Runs of that task read under the folder without approval; writing stays as it was.
 */

/** Folders one message carries, and one registration takes. */
export const MAX_FOLDERS = 10;

/**
 * A registered folder. `id` stays the same for every registration of the same realpath; `path` is
 * that realpath and `name` its basename, which is all the page shows.
 */
export const FolderRefSchema = Type.Object(
  {
    id: Identifier,
    name: Type.String({ minLength: 1, maxLength: 255 }),
    path: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);
export type FolderRef = Static<typeof FolderRefSchema>;

/**
 * POST `/v1/folders/register`, reachable only by the shell: it turns directories the user picked,
 * dropped or sent through the Finder service into folder refs. Each path must be absolute.
 */
export const FolderRegisterRequestSchema = Type.Object(
  {
    paths: Type.Array(Type.String({ minLength: 1, maxLength: 4096 }), {
      minItems: 1,
      maxItems: MAX_FOLDERS,
    }),
  },
  { additionalProperties: false },
);
export type FolderRegisterRequest = Static<typeof FolderRegisterRequestSchema>;

/**
 * Why a path was not registered, for the client's own wording: it could not be read, it is not a
 * directory, or it is a folder no task may read (`/`, the home directory or a folder that holds it,
 * or the service's data directory or anything inside it).
 */
export const FolderRegisterFailureReasonSchema = Type.Union([
  Type.Literal('unreadable'),
  Type.Literal('notDirectory'),
  Type.Literal('forbidden'),
]);
export type FolderRegisterFailureReason = Static<typeof FolderRegisterFailureReasonSchema>;

/** Every requested path lands in exactly one list; both keep request order. */
export const FolderRegisterResponseSchema = Type.Object(
  {
    registered: Type.Array(
      Type.Object(
        { path: Type.String(), folder: FolderRefSchema },
        { additionalProperties: false },
      ),
    ),
    failures: Type.Array(
      Type.Object(
        {
          path: Type.String(),
          reason: FolderRegisterFailureReasonSchema,
          /** English explanation naming only the folder's basename. */
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type FolderRegisterResponse = Static<typeof FolderRegisterResponseSchema>;

/**
 * The folders granted to a task: `GET /v1/tasks/:taskId/folders`, and
 * `DELETE /v1/tasks/:taskId/folders/:folderId`, which revokes one for later runs and answers the
 * folders that remain.
 */
export const TaskFoldersResponseSchema = Type.Object(
  { folders: Type.Array(FolderRefSchema) },
  { additionalProperties: false },
);
export type TaskFoldersResponse = Static<typeof TaskFoldersResponseSchema>;
