import path from 'node:path';
import type { Automation, FolderRef } from '@atd/agent-contracts';
import type { FolderStore } from '../folders/store.js';
import {
  fileStat,
  scanFolder,
  type FileStat,
  type FolderScan,
  type ScanOptions,
} from './folder-scan.js';
import {
  baselineSnapshot,
  consumeFiles,
  emptySnapshot,
  foldScan,
  readyFiles,
  type FolderSnapshots,
  type FoldMode,
} from './folder-snapshots.js';

/**
 * Polls the folders of enabled folder triggers (decision D8): one scan per automation per engine
 * tick, compared with its saved snapshot. The baseline is the folder as it was when the person
 * saved the trigger, turned the automation on or ended the global pause: those writes take it
 * before they answer (`baseline`), so a file added right after already fires. A folder that could
 * not be read then, or a trigger without a snapshot, is baselined by the first scan that reads it.
 * The first scan after a service start compares against the snapshot saved before, so changes
 * made while Atd was closed fire, or are skipped when the automation skips missed runs. Every
 * change to one automation's snapshot (a baseline, a scan, fired files, its run's own writes)
 * runs one at a time. A folder that does not answer in time (a network volume gone away) counts
 * as unavailable, and is not read again until the read that hung comes back.
 */

/** How a folder is read, and how long one read may take. */
export interface FolderScanner {
  scan: (root: string, options: ScanOptions) => Promise<FolderScan>;
  timeoutMs: number;
}

/** A 10,000-file folder reads in well under a second on a local disk. */
export const FOLDER_SCANNER: FolderScanner = { scan: scanFolder, timeoutMs: 15_000 };

export interface FolderWatchDeps {
  snapshots: FolderSnapshots;
  folders: Pick<FolderStore, 'resolve'>;
  /** The service data directory, which scans never enter. */
  dataDir: string;
  /** Status changed without a store write (a folder became unreadable or readable again). */
  changed: () => void;
  scanner: FolderScanner;
}

/** What one scan found for its automation. */
export interface FolderFindings {
  folder: FolderRef;
  /** Changes made while Atd was closed that the automation skips. */
  missed: string[];
}

/** The registered folder `id` names; undefined once it was unregistered. */
export function registeredFolder(
  folders: Pick<FolderStore, 'resolve'>,
  id: string,
): FolderRef | undefined {
  try {
    return folders.resolve([id])[0];
  } catch {
    return undefined;
  }
}

export class FolderWatch {
  /** Automations scanned since the service started. */
  private readonly started = new Set<string>();
  /** Automations whose baseline is owed: their folder could not be read when it was taken. */
  private readonly rebaselined = new Set<string>();
  /** Automations whose folder read has not come back yet, even when it timed out. */
  private readonly reading = new Set<string>();
  private closed = false;
  /** Automations whose folder the last scan could not read, or held too many files. */
  private readonly troubled = new Set<string>();
  /** The snapshot work queued per automation. */
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: FolderWatchDeps) {}

  /** Stops every later snapshot change: reads still in flight after a stop write nothing. */
  close(): void {
    this.closed = true;
  }

  /** Whether the last scan of the automation's folder failed (`folderUnavailable`). */
  inTrouble(automationId: string): boolean {
    return this.troubled.has(automationId);
  }

  /** Forgets a deleted or changed trigger's snapshot; the next scan starts over. */
  forget(automationId: string): Promise<void> {
    this.troubled.delete(automationId);
    return this.serial(automationId, () => this.deps.snapshots.remove(automationId));
  }

  /**
   * Takes the folder as it is now as the trigger's baseline: whatever is added or changed after
   * this moment fires. A folder that cannot be read now is reported (`inTrouble`) and baselined by
   * the first scan that reads it.
   */
  baseline(automation: Automation): Promise<void> {
    const { trigger } = automation;
    if (trigger.kind !== 'folder') return Promise.resolve();
    return this.serial(automation.id, async () => {
      const scan = await this.read(automation);
      if (!scan) {
        this.rebaselined.add(automation.id);
        return;
      }
      await this.deps.snapshots.write(automation.id, baselineSnapshot(trigger.folderId, scan));
      this.rebaselined.delete(automation.id);
      // Later scans compare with this baseline, also the first one since the service started.
      this.started.add(automation.id);
    });
  }

  /** Scans the automation's folder; null when the folder is not registered or not readable. */
  scan(automation: Automation, now: number): Promise<FolderFindings | null> {
    const { trigger } = automation;
    if (trigger.kind !== 'folder') return Promise.resolve(null);
    // Unregistered: the status reports `unknownFolder`.
    const folder = registeredFolder(this.deps.folders, trigger.folderId);
    if (!folder) return Promise.resolve(null);
    return this.serial(automation.id, async () => {
      const files = await this.read(automation);
      if (!files) return null;
      const saved = await this.deps.snapshots.read(automation.id);
      const current = saved?.folderId === trigger.folderId ? saved : null;
      const mode = this.mode(automation, current !== null);
      const snapshot = current ?? emptySnapshot(trigger.folderId);
      const { absorbed, dirty } = foldScan(snapshot, files, trigger.events, mode, now);
      if (dirty || !current) await this.deps.snapshots.write(automation.id, snapshot);
      return { folder, missed: mode === 'skipNew' ? absorbed : [] };
    });
  }

  /** Settled changes ready to fire, oldest first, relative to the folder. */
  ready(automationId: string): Promise<string[]> {
    return this.serial(automationId, async () => {
      const snapshot = await this.deps.snapshots.read(automationId);
      return snapshot ? readyFiles(snapshot) : [];
    });
  }

  /** Marks fired files as known, after their run's receipt was written. */
  consume(automationId: string, files: readonly string[]): Promise<void> {
    return this.serial(automationId, async () => {
      const snapshot = await this.deps.snapshots.read(automationId);
      if (!snapshot || this.closed) return;
      consumeFiles(snapshot, files);
      await this.deps.snapshots.write(automationId, snapshot);
    });
  }

  /**
   * Takes the files the automation's own run wrote through its write and edit tools (its `wrote`
   * audit lines, unattended.ts) as they are now, so its output never fires it again; every other
   * change made during the run still fires afterwards. Call it before the run's record settles:
   * the automation counts as running until then, so nothing fires in between. A file the run
   * changed through the shell leaves no line; single-flight and the limit of 12 trigger fires an
   * hour (records.ts) bound the loop such a run can make.
   */
  absorbWrites(automation: Automation, written: readonly string[]): Promise<void> {
    const { trigger } = automation;
    const folder =
      trigger.kind === 'folder' && registeredFolder(this.deps.folders, trigger.folderId);
    if (!folder || trigger.kind !== 'folder') return Promise.resolve();
    // Scans key files by NFC-normalized relative paths; audit lines carry NFC real paths.
    const root = folder.path.normalize('NFC');
    const files = written
      .map((file) => path.relative(root, file.normalize('NFC')))
      .filter((relative) => relative && !relative.startsWith('..') && !path.isAbsolute(relative))
      .map((relative) => relative.split(path.sep).join('/'));
    if (!files.length) return Promise.resolve();
    return this.serial(automation.id, async () => {
      const snapshot = await this.deps.snapshots.read(automation.id);
      if (snapshot?.folderId !== trigger.folderId || this.closed) return;
      for (const file of files) {
        delete snapshot.pending[file];
        const stat = await fileStat(path.join(folder.path, ...file.split('/')));
        if (stat) snapshot.known[file] = stat;
        else delete snapshot.known[file];
      }
      await this.deps.snapshots.write(automation.id, snapshot);
    });
  }

  /** The files of the automation's folder; null (and reported) when it cannot be read. */
  private async read(automation: Automation): Promise<ReadonlyMap<string, FileStat> | null> {
    const { trigger, id } = automation;
    if (trigger.kind !== 'folder' || this.closed) return null;
    const folder = registeredFolder(this.deps.folders, trigger.folderId);
    if (!folder) return null;
    // A read that never came back keeps the folder unavailable; another would only hang as well.
    if (this.reading.has(id)) {
      this.mark(id, true);
      return null;
    }
    const abort = new AbortController();
    const { scan, timeoutMs } = this.deps.scanner;
    const reading = scan(folder.path, {
      recursive: trigger.recursive,
      patterns: trigger.patterns,
      dataDir: this.deps.dataDir,
      signal: abort.signal,
    });
    this.reading.add(id);
    void reading.finally(() => this.reading.delete(id)).catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref();
    });
    const result = await Promise.race([reading, late]).finally(() => clearTimeout(timer));
    if (!result) abort.abort();
    this.mark(id, !result?.ok);
    return result?.ok && !this.closed ? result.files : null;
  }

  private serial<T>(automationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(automationId) ?? Promise.resolve();
    const next = previous.then(work, work);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(automationId, settled);
    void settled.then(() => {
      if (this.chains.get(automationId) === settled) this.chains.delete(automationId);
    });
    return next;
  }

  private mode(automation: Automation, saved: boolean): FoldMode {
    const first = !this.started.has(automation.id);
    this.started.add(automation.id);
    const fresh = this.rebaselined.delete(automation.id);
    if (!saved || fresh) return 'baseline';
    return first && automation.policy.missedRuns === 'skip' ? 'skipNew' : 'track';
  }

  private mark(automationId: string, trouble: boolean): void {
    if (trouble === this.troubled.has(automationId)) return;
    if (trouble) this.troubled.add(automationId);
    else this.troubled.delete(automationId);
    this.deps.changed();
  }
}

/** The absolute paths of files relative to a watched folder. */
export function absoluteFiles(folder: FolderRef, files: readonly string[]): string[] {
  return files.map((file) => path.join(folder.path, ...file.split('/')));
}
