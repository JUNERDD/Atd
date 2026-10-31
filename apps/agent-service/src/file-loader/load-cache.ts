import {
  entryKey,
  sourceVersion,
  type ExtractionLayout,
  type SourceVersion,
} from './extraction-paths.js';
import { entryInPlace, loadIntoStore } from './extraction-store.js';
import {
  fileLoader,
  type FileHint,
  type FileLoader,
  type LoadedFile,
  type LoadFileOptions,
} from './loader.js';

/** Converted files the cache keeps, by count and by total size. */
const CACHE_ENTRIES = 32;
const CACHE_BYTES = 128 * 1024 * 1024;

/**
 * How a file is known to the loader besides its path, the call's abort signal, the recognition a
 * run's material asks for (loader.ts `Recognize`), and the store that keeps what a conversion
 * extracts (extraction-paths.ts).
 */
export interface LoadOptions extends Omit<LoadFileOptions, 'out'> {
  hint?: FileHint;
  extractions?: ExtractionLayout;
}

/**
 * A file on disk as the loader turns it into model input, through one process-wide cache that
 * `read` and a run's attachment material share, so a file loaded for one is not converted again
 * for the other. Successful conversions (decoded, extracted, recognized or descriptive text, and
 * converted images) are cached by the file's version (extraction-paths.ts `entryKey`: path, size,
 * modification and status-change time, inode, hint), the recognition asked for and the store; the
 * status change time catches a rewrite that restored the modification time. Text whose
 * recognition stopped early, at its time limit or on a failure, is kept like the rest, so later
 * runs of the file do not wait for it again. A failed extraction is not kept, so a later load
 * tries again; a file whose own bytes are its text and an image that needed no conversion pass
 * through uncached, since reading them again costs no more.
 * With `extractions`, a load whose text is the file's content also keeps it as the version's
 * entry in that store (extraction-store.ts), and the text names the files the extraction wrote
 * there; a cached load whose entry the sweep removed is loaded again, which restores it. Without,
 * nothing is written.
 * `real` must already be the confined real path: an entry is the file's own content, reached only
 * after the caller allowed that path.
 */
export async function loadPathCached(
  real: string,
  options: LoadOptions = {},
  loader: FileLoader = fileLoader,
): Promise<LoadedFile> {
  const { extractions, ...load } = options;
  const version = await sourceVersion(real, load.hint);
  // With a store the text names the files written there, so its loads never share a conversion
  // with loads without one.
  const key = [entryKey(version), load.recognize?.tokens, extractions?.root].join('\0');
  const cached = cache.get(key);
  if (cached && (await inPlace(cached, version, extractions))) return cached;
  const loaded = extractions
    ? await loadIntoStore(
        extractions,
        version,
        key,
        (out) => loader.loadPath(real, out === undefined ? load : { ...load, out }),
        load.signal,
      )
    : await loader.loadPath(real, load);
  switch (loaded.kind) {
    case 'utf8':
      return loaded;
    case 'text':
      return loaded.failed
        ? loaded
        : cache.put(key, loaded, Buffer.byteLength(loaded.text, 'utf8'));
    case 'image':
      return loaded.convertedFrom ? cache.put(key, loaded, loaded.bytes.byteLength) : loaded;
  }
}

/** Whether a cached load still stands: the entry it names, if any, is still in the store. */
async function inPlace(
  cached: LoadedFile,
  version: SourceVersion,
  extractions: ExtractionLayout | undefined,
): Promise<boolean> {
  const entry = cached.kind === 'text' ? cached.content?.entry : undefined;
  // Content without an entry may have met a temporarily unavailable store; let it recover.
  if (extractions && cached.kind === 'text' && cached.content && !entry) return false;
  return !entry || !extractions || entryInPlace(extractions, version, entry);
}

/** The most recently used conversions, bounded by `CACHE_ENTRIES` and `CACHE_BYTES`. */
class ConversionCache {
  private readonly entries = new Map<string, { file: LoadedFile; bytes: number }>();
  private bytes = 0;

  get(key: string): LoadedFile | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry?.file;
  }

  put(key: string, file: LoadedFile, bytes: number): LoadedFile {
    if (bytes > CACHE_BYTES) return file;
    this.drop(key);
    this.entries.set(key, { file, bytes });
    this.bytes += bytes;
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= CACHE_ENTRIES && this.bytes <= CACHE_BYTES) break;
      this.drop(oldest);
    }
    return file;
  }

  private drop(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.bytes -= entry.bytes;
  }
}

const cache = new ConversionCache();
