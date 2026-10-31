import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * The version of what an extraction writes: its text, the files beside it and their names. Bump it
 * when any of them changes, so an entry an older extractor wrote is never read as current.
 */
export const EXTRACTOR_VERSION = 1;

/**
 * A source file's version as its entry is keyed and checked: the load cache's identity of a file
 * (load-cache.ts) plus its inode, so a file replaced in place counts as another version.
 */
export interface SourceVersion {
  /** The source's real path. */
  real: string;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  /** The name and media type the source is known by when its path does not say (a resource's). */
  name?: string;
  mime?: string;
}

/** What the store records of an entry's one source: its version, when it was made and last used. */
export interface SourceRecord extends SourceVersion {
  producedAt: number;
  usedAt: number;
}

/**
 * Where the file loader keeps what it extracts of documents (`<dataDir>/extractions`):
 * - `entries/<key>/`: one immutable entry per source version, its full text and the files beside
 *   it (whole sheets, pictures) with a manifest. Readers may open an entry exactly as they may its
 *   source (`extractionSource`).
 * - `sources/<key>.json`: the service's record of each entry's source, never readable by tools.
 * - `staging/<random>/`: an extraction in progress, renamed to its entry once complete.
 */
export interface ExtractionLayout {
  root: string;
  entries: string;
  sources: string;
  staging: string;
}

const KEY = /^[0-9a-f]{64}$/;

export function extractionLayout(extractionsDir: string): ExtractionLayout {
  return {
    root: extractionsDir,
    entries: path.join(extractionsDir, 'entries'),
    sources: path.join(extractionsDir, 'sources'),
    staging: path.join(extractionsDir, 'staging'),
  };
}

/** A source version's entry key: hex SHA-256 over the extractor version and the version's fields. */
export function entryKey(source: SourceVersion): string {
  const fields = [
    EXTRACTOR_VERSION,
    source.real,
    source.size,
    source.mtimeMs,
    source.ctimeMs,
    source.ino,
    source.name ?? '',
    source.mime ?? '',
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

/** The version of the file at `real` as it is now, with the hint it is known by. */
export async function sourceVersion(
  real: string,
  hint: { name?: string | undefined; mime?: string | undefined } = {},
): Promise<SourceVersion> {
  const info = await stat(real);
  return {
    real,
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    ino: info.ino,
    ...(hint.name === undefined ? {} : { name: hint.name }),
    ...(hint.mime === undefined ? {} : { mime: hint.mime }),
  };
}

/**
 * The entry a real path lies in: its key and its directory; null for any other path, including the
 * store's own directories, a source record, a staging directory and a malformed key.
 */
export async function entryAt(
  layout: ExtractionLayout,
  real: string,
): Promise<{ key: string; dir: string } | null> {
  const entries = await realOrResolved(layout.entries);
  const relative = path.relative(foldCase(entries), foldCase(real));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const key = relative.split(path.sep, 1)[0] ?? '';
  return KEY.test(key) ? { key, dir: path.join(entries, key) } : null;
}

/** The record of entry `key`'s source; null when it is missing or malformed. */
export async function sourceRecord(
  layout: ExtractionLayout,
  key: string,
): Promise<SourceRecord | null> {
  if (!KEY.test(key)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(layout.sources, `${key}.json`), 'utf8'));
  } catch {
    return null;
  }
  return isSourceRecord(raw) ? raw : null;
}

/**
 * The real path of the source whose entry holds `real`: when `real` lies in an entry whose recorded
 * source still exists in the recorded version. Null otherwise. A reader opens the entry without a
 * confirmation exactly when it may so open this source; recording a source grants nothing by itself.
 */
export async function extractionSource(
  layout: ExtractionLayout,
  real: string,
): Promise<string | null> {
  const entry = await entryAt(layout, real);
  const record = entry ? await sourceRecord(layout, entry.key) : null;
  if (!entry || !record || entryKey(record) !== entry.key) return null;
  try {
    const current = await sourceVersion(record.real, record);
    return entryKey(current) === entry.key ? record.real : null;
  } catch {
    return null;
  }
}

function isSourceRecord(value: unknown): value is SourceRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record: Partial<Record<keyof SourceRecord, unknown>> = value;
  const numbers = ['size', 'mtimeMs', 'ctimeMs', 'ino', 'producedAt', 'usedAt'] as const;
  return (
    typeof record.real === 'string' &&
    path.isAbsolute(record.real) &&
    numbers.every((field) => typeof record[field] === 'number') &&
    (record.name === undefined || typeof record.name === 'string') &&
    (record.mime === undefined || typeof record.mime === 'string')
  );
}

async function realOrResolved(absolute: string): Promise<string> {
  try {
    return await realpath(absolute);
  } catch {
    return path.resolve(absolute);
  }
}

/** Paths compare case-insensitively where the file system usually is (as service-fs.ts does). */
function foldCase(value: string): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? value.toLowerCase()
    : value;
}
