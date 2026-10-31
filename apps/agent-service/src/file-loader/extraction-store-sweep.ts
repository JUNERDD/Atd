import type { Dirent } from 'node:fs';
import { lstat, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { extractionSource, sourceRecord, type ExtractionLayout } from './extraction-paths.js';
import { producingEntry, removeUnloadedEntry } from './extraction-store.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long an entry no load used stays: reading its source again produces it anew. */
const IDLE_MS = 30 * DAY_MS;
/** What all entries may hold together; past it the least recently used go. */
const STORE_BYTES = 2 * 1024 ** 3;
/** Age past which a staging directory or a record write was abandoned: no load takes that long. */
const ABANDONED_MS = HOUR_MS;
/** The first sweep waits until the service's start has settled; then one runs each day. */
const FIRST_SWEEP_DELAY_MS = 60_000;

/** Names the store gives (extraction-paths.ts, extraction-store.ts, config.ts `writeTextAtomic`). */
const ENTRY = /^[0-9a-f]{64}$/;
const RECORD = /^([0-9a-f]{64})\.json$/;
const RECORD_WRITE = /^[0-9a-f]{64}\.json\.[0-9a-f-]{36}\.tmp$/;
const STAGING = /^[0-9a-f]{32}$/;

/** An entry the sweep keeps unless the store holds too much. */
interface KeptEntry {
  key: string;
  usedAt: number;
  bytes: number;
}

/**
 * Keeps the store bounded, as of `now`. It removes entries whose record is missing or malformed
 * or whose source is gone or another version now (extraction-paths.ts `extractionSource`),
 * entries no load used for `IDLE_MS`, and then the least recently used while the rest hold more
 * than `STORE_BYTES`; then records without an entry, and the staging directories and record
 * writes an interrupted load left. Only names the store gives are touched, a link is removed as a
 * link and never followed, and an entry a load is producing or validating stays. Returns how
 * many entries went.
 */
export async function sweepExtractions(layout: ExtractionLayout, now: number): Promise<number> {
  const { kept, removed } = await sweepEntries(layout, now);
  let count = removed;
  let bytes = kept.reduce((sum, entry) => sum + entry.bytes, 0);
  for (const entry of kept.toSorted((a, b) => a.usedAt - b.usedAt)) {
    if (bytes <= STORE_BYTES) break;
    if (producingEntry(entry.key) || !(await removeEntry(layout, entry.key, entry.usedAt)))
      continue;
    bytes -= entry.bytes;
    count += 1;
  }
  await sweepRecords(layout, now);
  await sweepStaging(layout, now);
  return count;
}

/** Removes the entries that are invalid or idle; the rest with their sizes. */
async function sweepEntries(
  layout: ExtractionLayout,
  now: number,
): Promise<{ kept: KeptEntry[]; removed: number }> {
  // Entries are checked by their real path, as readers' paths are (extraction-paths.ts `entryAt`).
  const dir = await realpath(layout.entries).catch(() => null);
  const kept: KeptEntry[] = [];
  let removed = 0;
  if (!dir) return { kept, removed };
  for (const item of await listing(dir)) {
    const key = item.name;
    if (!ENTRY.test(key) || producingEntry(key)) continue;
    const entry = path.join(dir, key);
    const record = await sourceRecord(layout, key);
    const valid =
      item.isDirectory() && record !== null && (await extractionSource(layout, entry)) !== null;
    if (record && valid && record.usedAt >= now - IDLE_MS)
      kept.push({ key, usedAt: record.usedAt, bytes: await sizeOf(entry) });
    else if (await removeEntry(layout, key, record?.usedAt)) removed += 1;
  }
  return { kept, removed };
}

/** Removes the records whose entry is gone, and record writes an interrupted write left. */
async function sweepRecords(layout: ExtractionLayout, now: number): Promise<void> {
  for (const item of await listing(layout.sources)) {
    const file = path.join(layout.sources, item.name);
    const key = RECORD.exec(item.name)?.[1];
    const stray = key
      ? !producingEntry(key) && !(await exists(path.join(layout.entries, key)))
      : RECORD_WRITE.test(item.name) && (await olderThan(file, now - ABANDONED_MS));
    if (stray) {
      const remove = async () => {
        // A load may have restored the entry since the initial stray-record check.
        if (key && (await exists(path.join(layout.entries, key)))) return false;
        return rm(file, { force: true }).then(
          () => true,
          () => false,
        );
      };
      if (key) await removeUnloadedEntry(key, remove);
      else await remove();
    }
  }
}

/** Removes the staging directories an interrupted load or a terminated extraction left. */
async function sweepStaging(layout: ExtractionLayout, now: number): Promise<void> {
  for (const item of await listing(layout.staging)) {
    const staging = path.join(layout.staging, item.name);
    if (STAGING.test(item.name) && (await olderThan(staging, now - ABANDONED_MS)))
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Removes entry `key`, its record first so that no reader is entitled to an entry half removed;
 * false when it could not be removed. Files are read-only, but their directories are writable.
 */
async function removeEntry(
  layout: ExtractionLayout,
  key: string,
  usedAt: number | undefined,
): Promise<boolean> {
  return removeUnloadedEntry(key, async () => {
    // A cached use may have refreshed this entry after the sweep selected it for removal.
    if ((await sourceRecord(layout, key))?.usedAt !== usedAt) return false;
    try {
      await rm(path.join(layout.sources, `${key}.json`), { force: true });
      await rm(path.join(layout.entries, key), { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  });
}

/** Bytes of the files under `dir`, links not followed. */
async function sizeOf(dir: string): Promise<number> {
  let bytes = 0;
  for (const item of await listing(dir)) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) bytes += await sizeOf(file);
    else if (item.isFile()) bytes += (await lstat(file).catch(() => null))?.size ?? 0;
  }
  return bytes;
}

/** A directory's items with their own types (a link is a link); none when it cannot be read. */
async function listing(dir: string): Promise<Dirent[]> {
  return readdir(dir, { withFileTypes: true }).catch(() => []);
}

async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

/** Whether `file` was last changed before `cutoff`; false when it is gone. */
async function olderThan(file: string, cutoff: number): Promise<boolean> {
  return lstat(file).then(
    (info) => info.mtimeMs < cutoff,
    () => false,
  );
}

export interface ExtractionSweepDeps {
  layout: ExtractionLayout;
  log: Logger;
}

/**
 * Sweeps the store (`sweepExtractions`) a minute after the server listens and then daily, one
 * sweep at a time, as the resource store is swept (resources/gc.ts); closing the server stops the
 * schedule and waits for a sweep under way.
 */
export function scheduleExtractionSweeps(app: FastifyInstance, deps: ExtractionSweepDeps): void {
  let running: Promise<void> = Promise.resolve();
  const timers: NodeJS.Timeout[] = [];
  const sweep = () => {
    running = running
      .then(() => sweepExtractions(deps.layout, Date.now()))
      .then(
        (count) => {
          if (count) deps.log.info('Removed extraction entries.', { count });
        },
        (error: unknown) =>
          deps.log.warn('Extraction entries were not swept; the next sweep retries.', {
            error: errorMessage(error),
          }),
      );
  };
  app.addHook('onListen', () => {
    timers.push(setTimeout(sweep, FIRST_SWEEP_DELAY_MS).unref());
    timers.push(setInterval(sweep, DAY_MS).unref());
  });
  app.addHook('onClose', async () => {
    for (const timer of timers) clearTimeout(timer);
    await running;
  });
}
