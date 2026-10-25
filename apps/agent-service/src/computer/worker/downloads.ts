import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from 'playwright-core';
import { COMPUTER_MAX_DOWNLOADS } from '@atd/agent-contracts';
import { WorkerError } from './operations.js';
import { freeName } from './profile-downloads.js';
import { markDownloaded } from './quarantine.js';

/**
 * Where the browser's downloads go (contract spec v1.3 B3). The download root is
 * `<dataDir>/computer/downloads`, beside the upload root the host sets (`ATD_UPLOAD_ROOT`,
 * `<dataDir>/resources`); the page-changing calls of a run name the run's directory directly
 * inside it (`downloadDir`, `<root>/<runId>`). A download on a page that a call named, or on a
 * page in its opener chain, is saved only into the directory the last such call named. One on a
 * page no call named is the person's own: it goes where Chrome would put it without the worker,
 * the managed profile's download folder (profile-downloads.ts), and is cancelled only when that
 * folder is unknown. Chrome writes the bytes into `<root>/.staging/<pid>` first (Playwright's
 * artifacts directory, one per worker process), every artifact is deleted once saved or cancelled,
 * and the worker removes its staging directory when it stops, so a download a call caused never
 * lands in the profile's own download folder. A host may remove `<root>/.staging` of a worker it
 * killed. Each completed download of a run directory is reported once, on the reply of the next
 * call that names its directory (`take`); the person's own are never reported. Every saved file
 * carries the quarantine and origin metadata Chrome gives its own downloads (quarantine.ts); one
 * that could not be marked is deleted rather than kept unquarantined.
 */

const RUN_DIR = /^[A-Za-z0-9_-]{1,128}$/;
/** Records kept; the oldest are forgotten first. */
const MAX_RECORDS = 50;
/** Longest file name part kept of a suggested name, below the 255-byte name limit with the id. */
const NAME_MAX = 200;
/** How long a reply waits for downloads of its directory that are still being saved. */
const SETTLE_MS = 5_000;
const SETTLE_POLL_MS = 100;

/** The download root that belongs to an upload root `<dataDir>/resources`. */
export function downloadRootFor(uploadRoot: string | undefined): string | undefined {
  if (uploadRoot === undefined || !path.isAbsolute(uploadRoot)) return undefined;
  return path.join(path.dirname(path.resolve(uploadRoot)), 'computer', 'downloads');
}

/** A download as a reply reports it (`ActionResult.downloads` entries). */
export interface ReportedDownload {
  name: string;
  path: string;
  bytes: number;
}

export interface DownloadRecord {
  id: string;
  pageId: string;
  /** The suggested file name, cleaned: what the host reports and the service imports it as. */
  name: string;
  /** The run directory it was saved into, or would have been. */
  dir: string;
  state: 'inProgress' | 'completed' | 'failed';
  /** Whether a reply already reported it. */
  reported: boolean;
  /** The saved file, once completed. */
  path?: string;
  bytes?: number;
}

/** A suggested name as one plain file name: no directories, control characters or dot names. */
function cleanName(suggested: string): string {
  const base = path
    .basename(suggested)
    .replace(/[\p{Cc}/:\\]/gu, '_')
    .trim()
    .slice(0, NAME_MAX);
  return base === '' || base === '.' || base === '..' ? 'download' : base;
}

export class Downloads {
  /** Run directory (real path) by the page id a call named it for. */
  private readonly dirs = new Map<string, string>();
  private readonly records: DownloadRecord[] = [];

  /**
   * `root`: the download root, or undefined. `profileDir`: the managed profile's own download
   * folder, read when a person's download arrives (their preference may change meanwhile).
   */
  constructor(
    private readonly root: string | undefined,
    private readonly profileDir: () => Promise<string | undefined> = async () => undefined,
  ) {}

  /** This worker's Playwright artifacts directory, inside the root; undefined without a root. */
  staging(): string | undefined {
    return this.root === undefined
      ? undefined
      : path.join(this.root, '.staging', String(process.pid));
  }

  /** Removes this worker's staging directory with whatever Chrome left there; never throws. */
  async removeStaging(): Promise<void> {
    const dir = this.staging();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * The real path of a run directory a call named: exactly one `[A-Za-z0-9_-]` component inside
   * the root, created when missing, and not a link elsewhere.
   */
  async runDir(downloadDir: string): Promise<string> {
    if (this.root === undefined)
      throw new WorkerError('unsupported', 'This worker has no download root.');
    const resolved = path.resolve(downloadDir);
    const name = path.basename(resolved);
    if (path.dirname(resolved) !== path.resolve(this.root) || !RUN_DIR.test(name))
      throw new WorkerError('unsupported', 'downloadDir is not a run directory of the root.');
    await mkdir(resolved, { recursive: true, mode: 0o700 });
    const real = await realpath(resolved);
    if (real !== path.join(await realpath(this.root), name))
      throw new WorkerError('unsupported', 'downloadDir resolves outside the download root.');
    return real;
  }

  /** Sends later downloads of `pageId` (and of pages it opens) to `dir` (from `runDir`). */
  assign(pageId: string, dir: string): void {
    this.dirs.set(pageId, dir);
  }

  /** Forgets the pages that are gone. */
  keepOnly(pageIds: ReadonlySet<string>): void {
    for (const pageId of this.dirs.keys()) if (!pageIds.has(pageId)) this.dirs.delete(pageId);
  }

  /**
   * Saves one download of the first page of `chain` (its id, then its openers') into the run
   * directory the nearest of them was assigned, or, when none was, into the profile's own download
   * folder (`toProfile`). An empty chain (its page could not be identified) may hide a page a call
   * named, so its download is cancelled. `origin` is the URL of the page it started on. Never
   * throws.
   */
  async handle(download: Download, chain: readonly string[], origin: string): Promise<void> {
    const dir = chain.map((pageId) => this.dirs.get(pageId)).find((item) => item !== undefined);
    if (dir === undefined) return this.toProfile(download, chain.length > 0, origin);
    const record: DownloadRecord = {
      id: `d-${randomUUID()}`,
      pageId: chain[0] ?? 'unknown',
      name: cleanName(download.suggestedFilename()),
      dir,
      state: 'inProgress',
      reported: false,
    };
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    let saved: { path: string; bytes: number } | undefined;
    const target = path.join(dir, `${record.id}-${record.name}`);
    try {
      await download.saveAs(target);
      await markDownloaded(target, download.url(), origin);
      saved = { path: target, bytes: (await stat(target)).size };
    } catch {
      await rm(target, { force: true }).catch(() => undefined);
      saved = undefined;
    }
    // The staged artifact goes before the record settles, so a reported download left nothing
    // in the staging directory.
    await download.delete().catch(() => undefined);
    if (saved === undefined) record.state = 'failed';
    else Object.assign(record, { ...saved, state: 'completed' });
  }

  /**
   * A person's download: saved under its own name (Chrome's ` (n)` suffix when taken) into the
   * profile's download folder and marked like Chrome's own, or cancelled when that folder is
   * unknown or the page is not `known`. It is never recorded or reported, and its staged artifact
   * is deleted either way. Never throws.
   */
  private async toProfile(download: Download, known: boolean, origin: string): Promise<void> {
    let target: string | undefined;
    try {
      const dir = known ? await this.profileDir() : undefined;
      if (dir === undefined) await download.cancel();
      else {
        target = await freeName(dir, cleanName(download.suggestedFilename()));
        await download.saveAs(target);
        await markDownloaded(target, download.url(), origin);
      }
    } catch {
      await download.cancel().catch(() => undefined);
      if (target !== undefined) await rm(target, { force: true }).catch(() => undefined);
    }
    await download.delete().catch(() => undefined);
  }

  /** The downloads that went, or were meant to go, into one run directory, oldest first. */
  list(dir: string): Omit<DownloadRecord, 'dir' | 'reported'>[] {
    return this.records
      .filter((record) => record.dir === dir)
      .map(({ id, pageId, name, state, path: file, bytes }) => ({
        id,
        pageId,
        name,
        state,
        ...(file === undefined ? {} : { path: file }),
        ...(bytes === undefined ? {} : { bytes }),
      }));
  }

  /**
   * The completed downloads of `dir` no reply reported yet, after waiting (bounded) for those of
   * `dir` still being saved; each is reported once, at most `COMPUTER_MAX_DOWNLOADS` per reply.
   * One still in progress then, or beyond the cap, is reported by a later call.
   */
  async take(dir: string): Promise<ReportedDownload[]> {
    const deadline = Date.now() + SETTLE_MS;
    const pending = () => this.records.some((r) => r.dir === dir && r.state === 'inProgress');
    while (pending() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    const reported: ReportedDownload[] = [];
    for (const record of this.records) {
      if (reported.length === COMPUTER_MAX_DOWNLOADS) break;
      if (record.dir !== dir || record.reported || record.state !== 'completed') continue;
      if (record.path === undefined || record.bytes === undefined) continue;
      record.reported = true;
      reported.push({ name: record.name, path: record.path, bytes: record.bytes });
    }
    return reported;
  }
}
