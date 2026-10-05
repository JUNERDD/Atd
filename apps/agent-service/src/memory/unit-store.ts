import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes } from 'node:fs/promises';
import path from 'node:path';
import { errorMessage, type MemoryProblem, type MemoryUnit } from '@atd/agent-contracts';
import { writeTextAtomic } from '../config.js';
import {
  compareUnits,
  formatUnitFile,
  MEMORY_FILE,
  parseUnitFile,
  revisionOf,
  type UnitDraft,
} from './unit.js';

/**
 * The memory files under `<agentDir>/memory/` (agentDir is `<dataDir>/agent`, a protected write
 * root no agent file tool can write):
 *
 *     units/<id>/MEMORY.md     one unit; the folder name is its id
 *     units/.staging/<id>/     a unit being created, renamed into `units/` once written
 *     history/<id>/<time>.md   the last 20 versions of a unit's content
 *     trash/<id>/              deleted units, purged 30 days after deletion
 *
 * Files are the truth and may change under the service (a user's own edit, a crash): reads stat
 * every unit file at most once a second and re-read only those whose stat changed. A file that
 * does not hold a valid unit is a problem, listed for Settings and kept out of runs. Not safe for
 * concurrent use: the memory authority runs every read and write one at a time.
 */
export function memoryRoot(agentDir: string): string {
  return path.join(agentDir, 'memory');
}

/** Versions of a unit's content kept in `history/<id>/`. */
export const HISTORY_LIMIT = 20;
/** Days a deleted unit stays in `trash/` before the next load purges it. */
export const TRASH_DAYS = 30;
/** Reads within this many milliseconds of the last scan answer it without touching the disk. */
const RESCAN_MS = 1000;

/** Valid units in Settings order and the problems; `generation` grows with every change. */
export interface StoreSnapshot {
  units: readonly MemoryUnit[];
  problems: readonly MemoryProblem[];
  generation: number;
}

interface CachedFile {
  key: string;
  result: { unit: MemoryUnit } | { problem: string };
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function problem(file: string, message: string): MemoryProblem {
  return { path: file.slice(0, 4096), message: message.slice(0, 2000) };
}

export class UnitStore {
  private readonly cache = new Map<string, CachedFile>();
  private snapshot: StoreSnapshot = { units: [], problems: [], generation: 0 };
  private scannedAt = Number.NEGATIVE_INFINITY;
  /** Set by every write, so the next read scans even within the rescan interval. */
  private stale = true;

  constructor(readonly root: string) {}

  private get unitsDir() {
    return path.join(this.root, 'units');
  }

  private get stagingDir() {
    return path.join(this.unitsDir, '.staging');
  }

  private get historyDir() {
    return path.join(this.root, 'history');
  }

  private get trashDir() {
    return path.join(this.root, 'trash');
  }

  private unitFile(id: string): string {
    return path.join(this.unitsDir, id, MEMORY_FILE);
  }

  /**
   * Readies the store when the authority loads: drops creates a crash left in staging and purges
   * trash older than `TRASH_DAYS` with its history. A purge failure is reported, not fatal.
   */
  async prepare(warn: (message: string) => void): Promise<void> {
    await mkdir(this.unitsDir, { recursive: true });
    await rm(this.stagingDir, { recursive: true, force: true });
    try {
      const entries = await readdir(this.trashDir).catch((error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      });
      const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
      for (const id of entries) {
        if ((await stat(path.join(this.trashDir, id))).mtimeMs >= cutoff) continue;
        await rm(path.join(this.trashDir, id), { recursive: true, force: true });
        await rm(path.join(this.historyDir, id), { recursive: true, force: true });
      }
    } catch (error) {
      warn(`Deleted memories could not be purged (${errorMessage(error)}).`);
    }
  }

  /** The current units and problems; `force` scans even within the rescan interval. */
  async read(force = false): Promise<StoreSnapshot> {
    if (!force && !this.stale && Date.now() - this.scannedAt < RESCAN_MS) return this.snapshot;
    const entries = await readdir(this.unitsDir, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (isMissing(error)) return [];
        throw error;
      },
    );
    let changed = this.stale;
    const problems: MemoryProblem[] = [];
    const found: MemoryUnit[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const folder = path.join(this.unitsDir, entry.name);
      if (!entry.isDirectory()) {
        problems.push(problem(folder, 'Only memory folders belong in the units folder.'));
        continue;
      }
      seen.add(entry.name);
      const file = path.join(folder, MEMORY_FILE);
      const read = await this.scanFile(entry.name, file);
      changed ||= read.changed;
      if ('unit' in read.result) found.push(read.result.unit);
      else problems.push(problem(file, read.result.problem));
    }
    for (const id of this.cache.keys()) {
      if (seen.has(id)) continue;
      this.cache.delete(id);
      changed = true;
    }
    this.snapshot = this.build(found, problems, changed);
    this.scannedAt = Date.now();
    this.stale = false;
    return this.snapshot;
  }

  /**
   * One unit file, re-read only when its stat changed since the last scan; `changed` says whether
   * its result may differ from the last scan's.
   */
  private async scanFile(id: string, file: string) {
    const cached = this.cache.get(id);
    const remember = (key: string, result: CachedFile['result']) => {
      this.cache.set(id, { key, result });
      return { changed: cached?.key !== key, result };
    };
    let key: string;
    try {
      const info = await stat(file);
      key = `${info.ino}:${info.size}:${info.mtimeMs}`;
    } catch (error) {
      const message = isMissing(error) ? 'MEMORY.md is missing.' : errorMessage(error);
      return remember(`failed:${message}`, { problem: message });
    }
    if (cached?.key === key) return { changed: false, result: cached.result };
    try {
      return remember(key, parseUnitFile(await readFile(file, 'utf8'), id));
    } catch (error) {
      return remember(key, { problem: `MEMORY.md could not be read: ${errorMessage(error)}` });
    }
  }

  /**
   * The snapshot of `found` units; its generation grows when a unit file `changed`. Names must be
   * unique: when files edited outside the service share one, the earliest created keeps it and
   * the others are problems until renamed.
   */
  private build(found: MemoryUnit[], problems: MemoryProblem[], changed: boolean): StoreSnapshot {
    const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const byAge = [...found].sort((a, b) => text(a.created, b.created) || text(a.id, b.id));
    const names = new Set<string>();
    const units: MemoryUnit[] = [];
    for (const unit of byAge) {
      if (names.has(unit.name)) {
        const message = `Another memory already uses the name "${unit.name}".`;
        problems.push(problem(this.unitFile(unit.id), message));
        continue;
      }
      names.add(unit.name);
      units.push(unit);
    }
    units.sort(compareUnits);
    const generation = this.snapshot.generation + (changed ? 1 : 0);
    return { units, problems, generation };
  }

  /** Writes a new unit into staging, then renames its folder into `units/`. */
  async create(draft: UnitDraft): Promise<MemoryUnit> {
    const text = formatUnitFile(draft);
    const staged = path.join(this.stagingDir, draft.id);
    await rm(staged, { recursive: true, force: true });
    await writeTextAtomic(path.join(staged, MEMORY_FILE), text);
    await rename(staged, path.join(this.unitsDir, draft.id));
    this.stale = true;
    return { ...draft, revision: revisionOf(text) };
  }

  /** Rewrites an existing unit; with `history`, its current file is kept as a version first. */
  async overwrite(draft: UnitDraft, history: boolean): Promise<MemoryUnit> {
    const file = this.unitFile(draft.id);
    if (history) await this.keepVersion(draft.id, await readFile(file, 'utf8'));
    const text = formatUnitFile(draft);
    await writeTextAtomic(file, text);
    this.stale = true;
    return { ...draft, revision: revisionOf(text) };
  }

  /** Moves a unit's folder to the trash; its time there starts now. */
  async trash(id: string): Promise<void> {
    const target = path.join(this.trashDir, id);
    await mkdir(this.trashDir, { recursive: true });
    await rm(target, { recursive: true, force: true });
    await rename(path.join(this.unitsDir, id), target);
    const now = new Date();
    await utimes(target, now, now);
    this.stale = true;
  }

  private async keepVersion(id: string, text: string): Promise<void> {
    const dir = path.join(this.historyDir, id);
    // Time first, so names sort by age; the suffix keeps two saves in one millisecond apart.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await writeTextAtomic(path.join(dir, `${stamp}-${randomUUID().slice(0, 8)}.md`), text);
    const versions = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
    for (const name of versions.slice(0, -HISTORY_LIMIT))
      await rm(path.join(dir, name), { force: true });
  }
}
