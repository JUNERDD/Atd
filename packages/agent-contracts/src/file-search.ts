import { Type, type Static } from 'typebox';
import { MAX_ATTACHMENTS } from './attachments.js';
import { Identifier } from './identifiers.js';
import { ResourceRefSchema } from './resources.js';

/**
 * One search surface (a panel window), chosen by its client. A newer search on the same channel
 * supersedes the older one, and result ids attach only through the channel they were issued to.
 */
export const FileSearchChannelSchema = Identifier;

const QueryFields = {
  /** An empty query asks for recent files only. */
  query: Type.String({ maxLength: 200 }),
  /** Results wanted; the service answers at most 20. */
  limit: Type.Integer({ minimum: 1, maximum: 30 }),
};

/** What a search surface asks, before its client adds the channel. */
export const FileSearchQuerySchema = Type.Object(QueryFields, { additionalProperties: false });
export type FileSearchQuery = Static<typeof FileSearchQuerySchema>;

/** POST `/v1/files/search`. */
export const FileSearchRequestSchema = Type.Object(
  { channel: FileSearchChannelSchema, ...QueryFields },
  { additionalProperties: false },
);
export type FileSearchRequest = Static<typeof FileSearchRequestSchema>;

/**
 * Opaque ids the service issued for search results; each expires 10 minutes after the latest
 * reply that listed it.
 */
export const FileResultIdsSchema = Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
  minItems: 1,
  maxItems: MAX_ATTACHMENTS,
});

/** POST `/v1/files/attach`. */
export const FileAttachRequestSchema = Type.Object(
  { channel: FileSearchChannelSchema, resultIds: FileResultIdsSchema },
  { additionalProperties: false },
);
export type FileAttachRequest = Static<typeof FileAttachRequestSchema>;

export const FileSearchResultSchema = Type.Object(
  {
    /**
     * Opaque id bound to the channel it was issued to. Every reply on that channel names the same
     * file with the same id, so clients may key rows by it.
     */
    resultId: Type.String({ minLength: 1, maxLength: 64 }),
    /** Basename. */
    name: Type.String(),
    /**
     * Parent directory relative to the home directory ('' = home), or below `iCloud Drive`;
     * never absolute.
     */
    location: Type.String(),
    /** The known format's family (`FileKind`), for its icon; null for a file of no known format. */
    kind: Type.Union([
      Type.Literal('text'),
      Type.Literal('code'),
      Type.Literal('data'),
      Type.Literal('document'),
      Type.Literal('spreadsheet'),
      Type.Literal('presentation'),
      Type.Literal('image'),
      Type.Literal('audio'),
      Type.Literal('video'),
      Type.Literal('archive'),
      Type.Null(),
    ]),
    /** Bytes. */
    size: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /** Last modification, epoch milliseconds; recent files for an empty query are the newest. */
    modifiedAt: Type.Union([Type.Number(), Type.Null()]),
    /** False for a file over the attachment size limit, which keeps its place in the list. */
    attachable: Type.Boolean(),
    reason: Type.Optional(Type.Literal('tooLarge')),
    /**
     * Query matches in the name, as the index found them: sorted, non-overlapping `[from, to)`
     * UTF-16 ranges into `name.normalize('NFC')`, the form the renderer highlights, covering
     * whole characters with their combining marks. They belong to the query this reply
     * answered. Absent when nothing in the name matched (recent files for an empty query, a file
     * found by a folder name) and when the index reports no ranges.
     */
    match: Type.Optional(
      Type.Array(Type.Tuple([Type.Integer({ minimum: 0 }), Type.Integer({ minimum: 0 })])),
    ),
  },
  { additionalProperties: false },
);
/** Match ranges are readonly, so clients can narrow results with their own matcher's ranges. */
export type FileSearchResult = Omit<Static<typeof FileSearchResultSchema>, 'match'> & {
  match?: ReadonlyArray<readonly [number, number]>;
};

export const FileSearchReplySchema = Type.Object(
  {
    /**
     * Results come in the index's rank order. `partial`: the search ran out of time, or the index
     * stopped keeping up with changes, so files may be missing. `indexing`: the index is still
     * opening or walking for the first time; the results cover the files found so far, and a
     * client that stays open asks again. `superseded`: a newer search on the same channel aborted
     * this one; the client drops it.
     */
    state: Type.Union([
      Type.Literal('ok'),
      Type.Literal('partial'),
      Type.Literal('indexing'),
      Type.Literal('unavailable'),
      Type.Literal('superseded'),
    ]),
    /**
     * Only with state `unavailable`. `unsupported`: this system has no file search. `retrying`:
     * the index failed to open and the service is trying again, so asking later may succeed.
     */
    reason: Type.Optional(Type.Union([Type.Literal('unsupported'), Type.Literal('retrying')])),
    results: Type.Array(FileSearchResultSchema, { maxItems: 20 }),
  },
  { additionalProperties: false },
);
export type FileSearchReply = Omit<Static<typeof FileSearchReplySchema>, 'results'> & {
  results: FileSearchResult[];
};

/** The resources created from the files behind the ids, in request order. */
export const FileAttachResponseSchema = Type.Object(
  { resources: Type.Array(ResourceRefSchema) },
  { additionalProperties: false },
);
export type FileAttachResponse = Static<typeof FileAttachResponseSchema>;
