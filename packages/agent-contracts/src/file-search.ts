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

/** Opaque ids the service issued for search results; they expire after 10 minutes. */
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

const Timestamp = Type.Union([Type.Number(), Type.Null()]);

export const FileSearchResultSchema = Type.Object(
  {
    /** Opaque id bound to the channel it was issued to. */
    resultId: Type.String({ minLength: 1, maxLength: 64 }),
    /** Basename. */
    name: Type.String(),
    /**
     * Parent directory relative to the home directory ('' = home), or below `iCloud Drive`;
     * never absolute.
     */
    location: Type.String(),
    kind: Type.Union([Type.Literal('text'), Type.Literal('code'), Type.Literal('data')]),
    /** Bytes. */
    size: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
    /** Epoch milliseconds. */
    modifiedAt: Timestamp,
    /** Epoch milliseconds. */
    usedAt: Timestamp,
    source: Type.Union([Type.Literal('recent'), Type.Literal('search')]),
    attachable: Type.Boolean(),
    reason: Type.Optional(Type.Literal('tooLarge')),
    /**
     * Query matches in the name: sorted, non-overlapping `[from, to)` UTF-16 ranges into
     * `name.normalize('NFC')`, the form the renderer highlights, covering whole characters with
     * their combining marks. They belong to the query this reply answered. Absent when nothing
     * in the name matched: recent files for an empty query, or a file found by a folder name.
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
    /** `superseded`: a newer search on the same channel aborted this one; the client drops it. */
    state: Type.Union([
      Type.Literal('ok'),
      Type.Literal('partial'),
      Type.Literal('unavailable'),
      Type.Literal('superseded'),
    ]),
    /** Only with state `unavailable`. */
    reason: Type.Optional(Type.Union([Type.Literal('indexDisabled'), Type.Literal('unsupported')])),
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
