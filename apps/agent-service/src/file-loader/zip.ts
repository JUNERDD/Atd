import { unzipSync, zipSync, type UnzipFileInfo } from 'fflate';

const MIB = 1024 * 1024;

/**
 * Bounds on every zip the loader reads: entries listed or scanned, and the uncompressed size of
 * all entries inflated. Office, OpenDocument, EPUB and iWork files are zips, so a zip bomb could
 * arrive under any of their names.
 */
export const ZIP_LIMITS = { entries: 10_000, totalBytes: 256 * MIB };

/** Compressed size up to which the main thread inflates an entry (a `mimetype` is stored). */
const TINY_ENTRY_BYTES = 1024;

/**
 * Parts the document parsers never read: pictures, embedded files, previews and thumbnails of
 * Office, OpenDocument and Numbers files. The default stored copy leaves them out, so a large
 * picture neither counts against `ZIP_LIMITS` nor gets inflated. Picture extraction opts into
 * selected media with its own allowance.
 */
const UNREAD_PARTS =
  /^(?:(?:word|xl|ppt)\/(?:media|embeddings)\/|docProps\/thumbnail\.|Pictures\/|Thumbnails\/|ObjectReplacements\/|Data\/|preview[^/]*\.jpg$)/;

export interface ZipEntry {
  name: string;
  /** Uncompressed size as the central directory declares it. */
  size: number;
}

/** A zip's entries in archive order; `more` when it holds more than `ZIP_LIMITS.entries`. */
export interface ZipListing {
  entries: ZipEntry[];
  more: boolean;
}

/** Optional media kept separately from parser parts; excess media is omitted, never inflated. */
export interface ZipMediaBudget {
  wanted: (file: UnzipFileInfo) => boolean;
  totalBytes: number;
  omitted: () => void;
}

/** Thrown from fflate's filter to stop listing at the entry cap. */
class ListingFull extends Error {}

/**
 * Whether an entry's compressed size fits the size it declares. fflate inflates into a buffer of
 * the declared size but decodes the entry's whole stream, so its work follows the real inflated
 * size. Deflate adds at most a few bytes per 64 KiB block to incompressible data, so a stream
 * longer than this margin must inflate to more than it declares. Refusing those entries keeps
 * inflating within about 1,032 times (deflate's largest ratio) the declared sizes `ZIP_LIMITS`
 * caps. Entries in other methods are never inflated.
 */
function sizesAgree(file: UnzipFileInfo): boolean {
  if (file.compression === 0) return file.size === file.originalSize;
  if (file.compression !== 8) return true;
  return file.size <= file.originalSize + file.originalSize / 64 + 1024;
}

/**
 * A zip's entries from its central directory, inflating none; null for bytes no zip reader
 * accepts and for an archive whose entries' sizes contradict each other (a zip bomb's lie).
 */
export function listZip(bytes: Uint8Array): ZipListing | null {
  const entries: ZipEntry[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        if (entries.length === ZIP_LIMITS.entries) throw new ListingFull();
        if (!sizesAgree(file)) throw new Error('an entry is larger than it declares');
        entries.push({ name: file.name, size: file.originalSize });
        return false;
      },
    });
  } catch (error) {
    if (error instanceof ListingFull) return { entries, more: true };
    return null;
  }
  return { entries, more: false };
}

/**
 * Inflates the entries `wanted` selects, refusing an archive past `ZIP_LIMITS` or holding an
 * entry larger than it declares before inflating further. Entries in a method fflate cannot
 * inflate (neither stored nor deflated) are left out. Optional media is checked the same way, but
 * counts against a separate allowance and is omitted on overflow. Extraction workers call this;
 * the main thread inflates only through `smallEntry`.
 */
export function unzipBounded(
  bytes: Uint8Array,
  wanted: (file: UnzipFileInfo) => boolean = () => true,
  media?: ZipMediaBudget,
): Record<string, Uint8Array> {
  let entries = 0;
  let total = 0;
  let mediaTotal = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      entries += 1;
      if (entries > ZIP_LIMITS.entries)
        throw new Error(
          `the archive has more than ${ZIP_LIMITS.entries.toLocaleString('en-US')} entries`,
        );
      const picture = media?.wanted(file) ?? false;
      if ((!picture && !wanted(file)) || (file.compression !== 0 && file.compression !== 8))
        return false;
      if (!sizesAgree(file)) throw new Error('one of its parts is larger than it declares');
      if (picture && media) {
        if (mediaTotal + file.originalSize > media.totalBytes) {
          media.omitted();
          return false;
        }
        mediaTotal += file.originalSize;
        return true;
      }
      total += file.originalSize;
      if (total > ZIP_LIMITS.totalBytes) throw new Error('its contents are too large to unpack');
      return true;
    },
  });
}

/**
 * The archive rebuilt with every part the parsers read stored uncompressed, after `unzipBounded`
 * checked it. mammoth and SheetJS inflate with readers of their own that set no size limit;
 * handed this copy they have nothing left to inflate. Pictures and embedded files are left out
 * (`UNREAD_PARTS`).
 */
export function storedCopy(bytes: Uint8Array): Uint8Array {
  return storedZip(readParts(bytes));
}

/** Parser parts, plus optional budgeted media, for rewriting before a stored copy is made. */
export function readParts(bytes: Uint8Array, media?: ZipMediaBudget): Record<string, Uint8Array> {
  return unzipBounded(bytes, (file) => !UNREAD_PARTS.test(file.name), media);
}

/** `parts` as an archive of stored (uncompressed) entries. */
export function storedZip(parts: Record<string, Uint8Array>): Uint8Array {
  return zipSync(parts, { level: 0 });
}

/**
 * One small entry's bytes, such as an OpenDocument `mimetype`, read on the main thread: only
 * when its compressed and declared sizes are both tiny. Undefined when absent or larger.
 */
export function smallEntry(
  bytes: Uint8Array,
  name: string,
  maxBytes: number,
): Uint8Array | undefined {
  try {
    const small = (file: UnzipFileInfo) =>
      file.name === name && file.size <= TINY_ENTRY_BYTES && file.originalSize <= maxBytes;
    return unzipBounded(bytes, small)[name];
  } catch {
    return undefined;
  }
}
