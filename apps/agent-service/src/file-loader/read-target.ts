import type { Stats } from 'node:fs';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ResolvePath } from '../tool-proxies.js';

/** Entries of a missing file's folder searched for close names: past this, none are offered. */
const SEARCHED_ENTRIES = 2000;
/** Close names a not-found message offers at most. */
const CLOSE_NAMES = 3;

/** Unicode spaces a name may hold where a plain space is typed, such as macOS's before AM/PM. */
const SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;
/** Apostrophes a name may hold where a straight one is typed. */
const APOSTROPHES = /[\u2018\u2019\u02BC]/g;

/** A file `read` may open: its confined real path and its status. */
export interface ReadTarget {
  real: string;
  info: Stats;
}

/**
 * The file a read names, at `target` (pi's resolved path), confined by `readable` as every read
 * operation is. A path the model can correct fails with a message saying how: a missing file
 * names up to three close names in its folder, a folder points at `ls`, and anything else that is
 * not a regular file (a pipe, a device) is refused before a read could block on it.
 */
export async function readTarget(readable: ResolvePath, target: string): Promise<ReadTarget> {
  const real = await readable(target);
  let info: Stats;
  try {
    info = await stat(real);
  } catch (error) {
    if (!isMissing(error)) throw error;
    throw new Error(await notFound(readable, target));
  }
  if (info.isDirectory()) throw new Error(`${target} is a directory. Use ls to list it.`);
  if (!info.isFile()) throw new Error(`${target} is not a regular file, so read cannot open it.`);
  return { real, info };
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}

/** `File not found: <target>`, then the close names its folder holds, when it holds any. */
async function notFound(readable: ResolvePath, target: string): Promise<string> {
  const message = `File not found: ${target}`;
  // Close names are a hint: a folder that cannot be listed just offers none.
  const names = await closeNames(readable, target).catch(() => []);
  if (!names.length) return message;
  return `${message}\nClose names in its folder: ${names.map((name) => JSON.stringify(name)).join(', ')}`;
}

/**
 * Names in a missing file's folder that differ from its name only in case, Unicode form, the
 * kind of space (macOS puts U+202F before AM/PM) or apostrophe, then names with the same stem
 * and another extension. The folder is listed only when `readable` allows it, and only its first
 * `SEARCHED_ENTRIES`, so a huge folder costs no more than a small one.
 */
async function closeNames(readable: ResolvePath, target: string): Promise<string[]> {
  const folder = await readable(path.dirname(target));
  const wanted = path.basename(target);
  const name = folded(wanted);
  const stem = folded(path.parse(wanted).name);
  const same: string[] = [];
  const related: string[] = [];
  let searched = 0;
  for await (const entry of await opendir(folder)) {
    searched += 1;
    if (searched > SEARCHED_ENTRIES) break;
    const shown = entry.isDirectory() ? `${entry.name}/` : entry.name;
    if (folded(entry.name) === name) same.push(shown);
    else if (folded(path.parse(entry.name).name) === stem) related.push(shown);
  }
  return [...same.sort(), ...related.sort()].slice(0, CLOSE_NAMES);
}

function folded(name: string): string {
  return name.normalize('NFC').toLowerCase().replace(SPACES, ' ').replace(APOSTROPHES, "'");
}
