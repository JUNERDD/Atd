import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AUTOMATION_FOLDER_MAX_DEPTH, AUTOMATION_FOLDER_MAX_FILES } from '@atd/agent-contracts';
import { inside } from '../service-fs.js';

/**
 * One polling scan of a watched folder (decision D8). Entries are read with `Dirent` and `lstat`,
 * so links are never followed and the scan stays inside the registered folder; hidden files,
 * Office lock files and partial downloads never count, and the service's own data directory is
 * never entered, so a folder that holds it does not fire on the service's own writes (the agent's
 * file tools can write nowhere else). Paths are NFC-normalized and `/`-separated, because macOS
 * reports names as stored and a decomposed name would otherwise miss a composed pattern.
 */

/**
 * What identifies a file's content version: its size and modification time, and its inode, so a
 * file replaced by an atomic save counts as changed. The change time is left out on purpose:
 * Finder tags, quarantine flags and other extended attributes move it without touching content.
 */
export interface FileStat {
  size: number;
  mtimeMs: number;
  ino: number;
}

export type FolderScan =
  | { ok: true; files: Map<string, FileStat> }
  /** `unavailable`: the folder is gone, unreadable or no longer the folder registered. */
  | { ok: false; reason: 'unavailable' | 'tooMany' };

/** Entries a scan looks at, matching or not, before it reports the folder as too large. */
const MAX_VISITED = AUTOMATION_FOLDER_MAX_FILES * 5;
/**
 * Files of one directory stat at once. File system calls share Node's few I/O threads, so a
 * network volume that stopped answering holds at most this many of them.
 */
const STAT_CONCURRENCY = 2;

/** Hidden files (`.DS_Store`, `.~lock`), Office lock files and partial downloads. */
export function ignoredName(name: string): boolean {
  return (
    name.startsWith('.') || name.startsWith('~$') || /\.(crdownload|download|part)$/i.test(name)
  );
}

function fold(value: string): string {
  return value.normalize('NFC').toLowerCase();
}

/** Case-insensitive base-name globs; no patterns match every name. */
export function nameMatcher(patterns: readonly string[]): (name: string) => boolean {
  const globs = patterns.map(fold);
  return (name) => !globs.length || globs.some((glob) => path.matchesGlob(fold(name), glob));
}

/** A regular file's version, never following a link; null when it is missing or not a file. */
export async function fileStat(file: string): Promise<FileStat | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile()) return null;
    const { size, mtimeMs, ino } = info;
    return { size, mtimeMs, ino };
  } catch {
    return null;
  }
}

export interface ScanOptions {
  recursive: boolean;
  patterns: readonly string[];
  /** The service data directory; never entered. */
  dataDir: string;
  /** Aborted when the scan took too long: it stops at its next directory or file. */
  signal?: AbortSignal;
}

/** Scans `root`, a registered folder's realpath. */
export async function scanFolder(root: string, options: ScanOptions): Promise<FolderScan> {
  try {
    if ((await realpath(root)) !== root) return { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const dataDir = await realpath(options.dataDir).catch(() => options.dataDir);
  const matches = nameMatcher(options.patterns);
  const maxDepth = options.recursive ? AUTOMATION_FOLDER_MAX_DEPTH : 0;
  const files = new Map<string, FileStat>();
  let visited = 0;

  const visit = async (dir: string, relative: string, depth: number, entry: Dirent) => {
    if (ignoredName(entry.name)) return null;
    const name = entry.name.normalize('NFC');
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return depth < maxDepth && !inside(dataDir, full) ? entry.name : null;
    if (!entry.isFile() || !matches(name)) return null;
    options.signal?.throwIfAborted();
    // Null when removed between the listing and the stat: the next scan sees it gone.
    const found = await fileStat(full);
    if (found) files.set(relative ? `${relative}/${name}` : name, found);
    return null;
  };

  const walk = async (dir: string, relative: string, depth: number): Promise<boolean> => {
    options.signal?.throwIfAborted();
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // The folder itself must be readable; a subfolder that is not is left out.
      if (depth === 0) throw error;
      return true;
    }
    visited += entries.length;
    if (visited > MAX_VISITED) return false;
    const folders: string[] = [];
    let next = 0;
    const worker = async () => {
      for (let entry = entries[next++]; entry; entry = entries[next++]) {
        const folder = await visit(dir, relative, depth, entry);
        if (folder !== null) folders.push(folder);
      }
    };
    await Promise.all(Array.from({ length: STAT_CONCURRENCY }, worker));
    if (files.size > AUTOMATION_FOLDER_MAX_FILES) return false;
    for (const folder of folders.sort()) {
      const key = relative ? `${relative}/${folder.normalize('NFC')}` : folder.normalize('NFC');
      if (!(await walk(path.join(dir, folder), key, depth + 1))) return false;
    }
    return true;
  };

  try {
    return (await walk(root, '', 0)) ? { ok: true, files } : { ok: false, reason: 'tooMany' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
