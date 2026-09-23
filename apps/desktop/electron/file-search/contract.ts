import { Type, type Static } from 'typebox';
import type { FileRef } from '../agent/task-schema';

export const FileSearchRequestSchema = Type.Object(
  { query: Type.String({ maxLength: 200 }), limit: Type.Integer({ minimum: 1, maximum: 30 }) },
  { additionalProperties: false },
);
export type FileSearchRequest = Static<typeof FileSearchRequestSchema>;

export const FileAttachRequestSchema = Type.Object(
  {
    resultIds: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      minItems: 1,
      maxItems: 10,
    }),
  },
  { additionalProperties: false },
);
export type FileAttachRequest = Static<typeof FileAttachRequestSchema>;

export interface FileSearchResult {
  /** Opaque id issued by main, bound to the panel sender, expires after 10 minutes. */
  resultId: string;
  /** Basename. */
  name: string;
  /** Parent directory relative to the home directory ('' = home); never absolute. */
  location: string;
  kind: 'text' | 'code' | 'data';
  /** Bytes. */
  size: number | null;
  /** Epoch milliseconds. */
  modifiedAt: number | null;
  /** Epoch milliseconds. */
  usedAt: number | null;
  source: 'recent' | 'search';
  attachable: boolean;
  reason?: 'tooLarge';
}

export interface FileSearchReply {
  /** `superseded`: a newer search from the same sender aborted this one; the renderer drops it. */
  state: 'ok' | 'partial' | 'unavailable' | 'superseded';
  /** Only with state `unavailable`. */
  reason?: 'indexDisabled' | 'unsupported';
  /** At most 20. */
  results: FileSearchResult[];
}

export interface FileSearchBridge {
  /** An empty query returns recent files only. */
  search(request: { query: string; limit: number }): Promise<FileSearchReply>;
  /** Reads and uploads the files behind the ids; rejects with English messages. */
  attach(resultIds: string[]): Promise<FileRef[]>;
}
