import { stat } from 'node:fs/promises';
import { fileLoader, type FileHint, type FileLoader, type LoadedFile } from './loader.js';

/** Converted files the cache keeps, by count and by total size. */
const CACHE_ENTRIES = 32;
const CACHE_BYTES = 128 * 1024 * 1024;

/** How a file is known to the loader besides its path, and the call's abort signal. */
export interface LoadOptions {
  hint?: FileHint;
  signal?: AbortSignal;
}

/**
 * A file on disk as the loader turns it into model input, through one process-wide cache that
 * `read` and a run's attachment material share, so a file loaded for one is not converted again
 * for the other. Successful conversions (decoded, extracted or descriptive text, and converted
 * images) are cached by path, size, modification and status-change time, and hint; the status
 * change time catches a rewrite that restored the modification time. A failed extraction is not
 * kept, so a later load tries again; a file whose own bytes are its text and an image that needed
 * no conversion pass through uncached, since reading them again costs no more.
 * `real` must already be the confined real path: an entry is the file's own content, reached only
 * after the caller allowed that path.
 */
export async function loadPathCached(
  real: string,
  options: LoadOptions = {},
  loader: FileLoader = fileLoader,
): Promise<LoadedFile> {
  const info = await stat(real);
  const { hint } = options;
  const key = [real, info.size, info.mtimeMs, info.ctimeMs, hint?.name, hint?.mime].join('\0');
  const cached = cache.get(key);
  if (cached) return cached;
  const loaded = await loader.loadPath(real, options);
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
