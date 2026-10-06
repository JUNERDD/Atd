import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import {
  AutomationFolderEventSchema,
  Identifier,
  type AutomationFolderEvent,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { automationsDir } from './files.js';
import type { FileStat } from './folder-scan.js';

/**
 * The persisted view a folder trigger compares each scan with (`folders/<automationId>.json`,
 * decision D8): the settled files it knows, and the changes waiting to fire. Because it survives
 * restarts, changes made while Atd was closed are found by the first scan after the next start.
 * A file fires only once it was unchanged across two scans (`settled`).
 */

const FileStatSchema = Type.Object(
  { size: Type.Number(), mtimeMs: Type.Number(), ino: Type.Number() },
  { additionalProperties: false },
);

const PendingSchema = Type.Object(
  {
    event: AutomationFolderEventSchema,
    stat: FileStatSchema,
    /** Unchanged since the previous scan: the file may fire. */
    settled: Type.Boolean(),
    /** When the change was first seen (epoch ms); batches take the oldest first. */
    since: Type.Number(),
  },
  { additionalProperties: false },
);

const FolderSnapshotSchema = Type.Object(
  {
    version: Type.Literal(1),
    /** The folder the snapshot describes; another folder starts over. */
    folderId: Identifier,
    /** Settled files by relative path. */
    known: Type.Record(Type.String(), FileStatSchema),
    /** Changes not fired yet by relative path. */
    pending: Type.Record(Type.String(), PendingSchema),
  },
  { additionalProperties: false },
);
export type FolderSnapshot = Static<typeof FolderSnapshotSchema>;

/**
 * How a scan is folded in. `baseline` takes the folder as it is (a new trigger, one turned back on
 * or changed); `skipNew` absorbs changes it has not seen pending yet (the first scan after a start
 * when missed runs are skipped); `track` turns every change into a pending entry.
 */
export type FoldMode = 'baseline' | 'skipNew' | 'track';

export function emptySnapshot(folderId: string): FolderSnapshot {
  return { version: 1, folderId, known: {}, pending: {} };
}

/** The folder as one scan found it, every file known and nothing waiting to fire. */
export function baselineSnapshot(
  folderId: string,
  files: ReadonlyMap<string, FileStat>,
): FolderSnapshot {
  return { version: 1, folderId, known: Object.fromEntries(files), pending: {} };
}

/** A different content version (folder-scan.ts `FileStat`): metadata alone never counts. */
function differs(a: FileStat, b: FileStat): boolean {
  return a.size !== b.size || a.mtimeMs !== b.mtimeMs || a.ino !== b.ino;
}

/**
 * Folds one scan into `snapshot`. A file the snapshot does not know is an `added` change, a
 * different version of a known file a `changed` one; changes of an event the trigger does not
 * watch are absorbed, a pending change unchanged since the last scan settles, and deleted files
 * are forgotten. Answers the watched changes the mode absorbed instead of tracking, and whether
 * the snapshot changed.
 */
export function foldScan(
  snapshot: FolderSnapshot,
  files: ReadonlyMap<string, FileStat>,
  events: readonly AutomationFolderEvent[],
  mode: FoldMode,
  now: number,
): { absorbed: string[]; dirty: boolean } {
  const absorbed: string[] = [];
  let dirty = false;
  for (const [file, stat] of files) {
    const known = snapshot.known[file];
    const event: AutomationFolderEvent | null = !known
      ? 'added'
      : differs(known, stat)
        ? 'changed'
        : null;
    const pending = snapshot.pending[file];
    const watched = event !== null && events.includes(event);
    const absorb = mode === 'baseline' || (mode === 'skipNew' && !pending);
    if (!watched || absorb) {
      if (watched) absorbed.push(file);
      if (event !== null) {
        snapshot.known[file] = stat;
        dirty = true;
      }
      if (pending) {
        delete snapshot.pending[file];
        dirty = true;
      }
      continue;
    }
    if (pending && !differs(pending.stat, stat)) {
      if (!pending.settled) {
        pending.settled = true;
        dirty = true;
      }
      continue;
    }
    // A file that appeared stays `added` while it is still being written.
    const kind = pending?.event === 'added' ? 'added' : event;
    snapshot.pending[file] = { event: kind, stat, settled: false, since: pending?.since ?? now };
    dirty = true;
  }
  for (const file of Object.keys(snapshot.known))
    if (!files.has(file)) {
      delete snapshot.known[file];
      dirty = true;
    }
  for (const file of Object.keys(snapshot.pending))
    if (!files.has(file)) {
      delete snapshot.pending[file];
      dirty = true;
    }
  return { absorbed, dirty };
}

/** Settled changes ready to fire, oldest first. */
export function readyFiles(snapshot: FolderSnapshot): string[] {
  return Object.entries(snapshot.pending)
    .filter(([, pending]) => pending.settled)
    .sort(([a, left], [b, right]) => left.since - right.since || (a < b ? -1 : 1))
    .map(([file]) => file);
}

/** Marks fired changes as known, so they never fire again. */
export function consumeFiles(snapshot: FolderSnapshot, files: readonly string[]): void {
  for (const file of files) {
    const pending = snapshot.pending[file];
    if (!pending) continue;
    snapshot.known[file] = pending.stat;
    delete snapshot.pending[file];
  }
}

/** The snapshot files of one service profile, cached after the first read. */
export class FolderSnapshots {
  private readonly cache = new Map<string, FolderSnapshot | null>();

  constructor(private readonly dataDir: string) {}

  /** The saved snapshot; null when there is none or it cannot be read (the next scan starts over). */
  async read(automationId: string): Promise<FolderSnapshot | null> {
    if (this.cache.has(automationId)) return structuredClone(this.cache.get(automationId) ?? null);
    let snapshot: FolderSnapshot | null = null;
    try {
      const raw: unknown = JSON.parse(await readFile(this.file(automationId), 'utf8'));
      if (Value.Check(FolderSnapshotSchema, raw)) snapshot = raw;
    } catch {
      // Missing or unreadable: the next scan takes the folder as it is.
    }
    this.cache.set(automationId, snapshot);
    return structuredClone(snapshot);
  }

  async write(automationId: string, snapshot: FolderSnapshot): Promise<void> {
    await atomicWrite(this.file(automationId), snapshot);
    this.cache.set(automationId, structuredClone(snapshot));
  }

  async remove(automationId: string): Promise<void> {
    this.cache.set(automationId, null);
    await rm(this.file(automationId), { force: true });
  }

  private file(automationId: string): string {
    return path.join(automationsDir(this.dataDir), 'folders', `${automationId}.json`);
  }
}
