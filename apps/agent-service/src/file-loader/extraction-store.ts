import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWrite } from '../config.js';
import {
  entryKey,
  sourceRecord,
  sourceVersion,
  type ExtractionLayout,
  type SourceRecord,
  type SourceVersion,
} from './extraction-paths.js';
import { extractionState as state, retainEntry } from './extraction-state.js';
import type { LoadedFile, TextContent } from './loader.js';
import { lineCount } from './material.js';
import type { ExtractedFiles } from './outputs.js';

/** How often at most an entry's record notes a use: the sweep keeps entries by their last use. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** Entries whose last noted use the process remembers; a forgotten one is noted at its next use. */
const REMEMBERED_TOUCHES = 1024;

/** An entry as the model is told of it: its directory and the files its text names. */
export interface ExtractionEntry {
  dir: string;
  files?: ExtractedFiles;
}

/** What an entry keeps of a load: the text `read` returns and how the manifest describes it. */
type EntryContent = Pick<TextContent, 'format' | 'files'> & { text: string };

/**
 * `load` of the source version `version`, run with a fresh staging directory as its extraction
 * output, its content (`TextContent`) kept as the version's entry: `text.txt` holds the text `read`
 * returns, `manifest.json` describes it and the files the extraction wrote beside it, every file
 * is made read-only and the directory is renamed into place whole. When another load placed the
 * entry first, this one's staging goes and that entry serves. Loads of one conversion (`id`) at
 * once run one load: a load that joins it still ends with its own `signal`, and loads again itself
 * when the one it joined ended without a result. The file comes back with `content.entry` naming
 * its entry and without `content.readText`; a store that cannot be written never fails the load,
 * which then comes back without an entry.
 */
export async function loadIntoStore(
  layout: ExtractionLayout,
  version: SourceVersion,
  id: string,
  load: (out: string | undefined) => Promise<LoadedFile>,
  signal?: AbortSignal,
): Promise<LoadedFile> {
  const { loading } = state();
  const shared = loading.get(id);
  if (shared) {
    try {
      return await untilAborted(shared, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      return loadIntoStore(layout, version, id, load, signal);
    }
  }
  const producing = produce(layout, version, load);
  loading.set(id, producing);
  try {
    return await producing;
  } finally {
    if (loading.get(id) === producing) loading.delete(id);
  }
}

/**
 * Whether entry `dir` of `version`, which a cached load names, is still in place: false once the
 * sweep removed it, so the file is loaded and its entry produced again. A use is noted in the
 * entry's record at most once an hour, which also restores a record a crash lost.
 */
export async function entryInPlace(
  layout: ExtractionLayout,
  version: SourceVersion,
  dir: string,
): Promise<boolean> {
  const key = entryKey(version);
  const release = await retainEntry(key);
  try {
    if (!(await isDirectory(dir))) return false;
    const now = Date.now();
    const last = state().touched.get(path.join(layout.sources, `${key}.json`));
    const record = await sourceRecord(layout, key);
    if (
      !record ||
      entryKey(record) !== key ||
      last === undefined ||
      now - last >= TOUCH_INTERVAL_MS
    ) {
      try {
        await writeRecord(layout, key, version, now);
      } catch {
        return false;
      }
    }
    return true;
  } finally {
    release();
  }
}

/** Whether a load is producing or validating entry `key`, which the sweep then leaves alone. */
export function producingEntry(key: string): boolean {
  return state().producing.has(key);
}

/** Reserves removal before its first await, so new producers and cached validations wait for it. */
export async function removeUnloadedEntry(
  key: string,
  remove: () => Promise<boolean>,
): Promise<boolean> {
  const { producing, removing } = state();
  if (producing.has(key) || removing.has(key)) return false;
  const { promise, resolve } = Promise.withResolvers<void>();
  removing.set(key, promise);
  try {
    return await remove();
  } finally {
    removing.delete(key);
    resolve();
  }
}

/** The entry a loaded file's content is kept in, when the store holds one. */
export function entryOf(loaded: LoadedFile): ExtractionEntry | undefined {
  if (loaded.kind !== 'text' || !loaded.content?.entry) return undefined;
  const { entry: dir, files } = loaded.content;
  return { dir, ...(files ? { files } : {}) };
}

/**
 * The app's note naming an entry, which `read` appends after a converted file's text and the run
 * material shows beside the file: the folder, and by example the files its text names, when there
 * are any. One line, whatever a file name holds.
 */
export function extractionNote({ dir, files }: ExtractionEntry): string {
  const examples = [files?.images[0]?.file, files?.sheets[0]?.file].flatMap((file) =>
    file === undefined ? [] : [file.replace(/[\r\n\u2028\u2029]+/g, ' ')],
  );
  const named = examples.length
    ? ` the paths its text names, such as ${examples.join(' or ')}, are inside this folder;`
    : '';
  const manifest = examples.length ? 'lists them' : 'describes it';
  return `[Extracted files: ${dir}/ — text.txt holds this file's text for grep;${named} manifest.json ${manifest}.]`;
}

async function produce(
  layout: ExtractionLayout,
  version: SourceVersion,
  load: (out: string | undefined) => Promise<LoadedFile>,
): Promise<LoadedFile> {
  const key = entryKey(version);
  const release = await retainEntry(key);
  const staging = await stagingDir(layout);
  try {
    const loaded = await load(staging);
    if (staging && loaded.kind === 'text' && loaded.outputFailed)
      return withoutReadText(await load(undefined));
    if (loaded.kind !== 'text' || !loaded.content) return loaded;
    const { readText, ...content } = loaded.content;
    // `read` drops one final LF before paging; keep its exact text without changing the load.
    const text = (readText ?? loaded.text).replace(/\n$/, '');
    const entry = staging
      ? await settle(layout, version, staging, { ...content, text }).catch(() => undefined)
      : undefined;
    if (!entry && (content.files?.images.length || content.files?.sheets.length)) {
      // A failed settlement discards its files; reload without output so no path names them.
      return withoutReadText(await load(undefined));
    }
    return { ...loaded, content: entry ? { ...content, entry } : content };
  } finally {
    // Gone once renamed into place; otherwise whatever the extraction wrote goes.
    if (staging) await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    release();
  }
}

/** A no-output retry keeps material text but has no store use for its extra read-only copy. */
function withoutReadText(loaded: LoadedFile): LoadedFile {
  if (loaded.kind !== 'text' || !loaded.content) return loaded;
  const content = { ...loaded.content };
  delete content.readText;
  return { ...loaded, content };
}

/**
 * A fresh staging directory in `layout.staging`, which the extraction makes once it writes a
 * file; undefined when the store cannot be written. The store's root is the user's alone.
 */
async function stagingDir(layout: ExtractionLayout): Promise<string | undefined> {
  try {
    await mkdir(layout.staging, { recursive: true, mode: 0o700 });
    return path.join(layout.staging, randomBytes(16).toString('hex'));
  } catch {
    return undefined;
  }
}

/**
 * Completes `staging` as the entry of `version` and returns the entry's directory, or undefined
 * when the source changed while it loaded: the entry would then hold another version than its key
 * names. Throws when the store cannot be written.
 */
async function settle(
  layout: ExtractionLayout,
  version: SourceVersion,
  staging: string,
  content: EntryContent,
): Promise<string | undefined> {
  const key = entryKey(version);
  if (!(await unchanged(version, key))) return undefined;
  await mkdir(staging, { recursive: true });
  await writeFile(path.join(staging, 'text.txt'), content.text, { flag: 'wx' });
  await writeFile(path.join(staging, 'manifest.json'), manifest(version, content), { flag: 'wx' });
  await readOnly(staging);
  const dir = path.join(layout.entries, key);
  await mkdir(layout.entries, { recursive: true, mode: 0o700 });
  try {
    await rename(staging, dir);
  } catch (error) {
    // Another load placed the entry first (an entry is never empty, so it is not replaced).
    if (!(await isDirectory(dir))) throw error;
  }
  await writeRecord(layout, key, version, Date.now());
  return dir;
}

/** Whether the source is still the version `key` names. */
async function unchanged(version: SourceVersion, key: string): Promise<boolean> {
  try {
    return entryKey(await sourceVersion(version.real, version)) === key;
  } catch {
    return false;
  }
}

/**
 * The entry's `manifest.json`, for the model: the source's format and name (never its path), the
 * text file and its lines as `read` counts them, and each file the entry holds or leaves out.
 */
function manifest(version: SourceVersion, { format, files, text }: EntryContent): string {
  const lines = lineCount(text);
  const described = {
    format,
    source: path.basename(version.name ?? version.real),
    text: { file: 'text.txt', lines },
    sheets: files?.sheets ?? [],
    images: files?.images ?? [],
    omitted: files?.omitted ?? [],
  };
  return `${JSON.stringify(described, null, 2)}\n`;
}

/** Makes every file under `dir` read-only; directories stay writable for the sweep, links as they are. */
async function readOnly(dir: string): Promise<void> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await readOnly(file);
    else if (item.isFile()) await chmod(file, 0o444);
  }
}

/**
 * Writes entry `key`'s source record (`sources/<key>.json`, never readable by tools) whole, as
 * used at `now`, keeping when the entry was produced.
 */
async function writeRecord(
  layout: ExtractionLayout,
  key: string,
  version: SourceVersion,
  now: number,
): Promise<void> {
  const known = await sourceRecord(layout, key);
  const producedAt = known && entryKey(known) === key ? known.producedAt : now;
  const record: SourceRecord = { ...version, producedAt, usedAt: now };
  const file = path.join(layout.sources, `${key}.json`);
  await atomicWrite(file, record);
  remember(file, now);
}

/** Notes that a source record was written at `at`, forgetting the least recent past the bound. */
function remember(file: string, at: number): void {
  const { touched } = state();
  touched.delete(file);
  touched.set(file, at);
  for (const oldest of touched.keys()) {
    if (touched.size <= REMEMBERED_TOUCHES) break;
    touched.delete(oldest);
  }
}

async function isDirectory(file: string): Promise<boolean> {
  return lstat(file).then(
    (info) => info.isDirectory(),
    () => false,
  );
}

/** `promise`'s outcome, or `signal`'s reason once it aborts first. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
