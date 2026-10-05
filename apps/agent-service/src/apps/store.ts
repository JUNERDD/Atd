import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { APP_ID_PATTERN, parse } from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import { appNotFound } from './errors.js';
import type { AppPaths } from './paths.js';
import { AppIndexSchema, AppRecordSchema, readRecord, type AppRecord } from './records.js';

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const APP_ID = new RegExp(APP_ID_PATTERN);

/** A fresh app id: `app-` and ten lowercase alphanumerics (a valid `ai-userapp://` host). */
export function newAppId(): string {
  let id = 'app-';
  for (let index = 0; index < 10; index += 1) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

/** The app's `WKWebsiteDataStore` id: an uppercase canonical UUID, fixed for the app's life. */
export function newDataStoreId(): string {
  return randomUUID().toUpperCase();
}

export function isAppId(value: string): boolean {
  return APP_ID.test(value);
}

/**
 * The service's app records: `<appId>/app.json` per app, and `index.json` with the revision, the
 * sole writer of both (modeled on commands/store.ts). Mutations are serialized; each writes the
 * app file, then the index with the next revision, then tells `onChanged` listeners (the server
 * turns that into an `apps` invalidate). Version directories, data and diagnostics are written by
 * their own modules; a record change publishes what they produced.
 */
export class AppStore {
  private chain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  private constructor(
    private readonly paths: AppPaths,
    private revisionValue: number,
    private readonly records: Map<string, AppRecord>,
  ) {}

  /** Loads every readable `app.json`; an unreadable app is skipped and left on disk. */
  static async load(paths: AppPaths, warn: (message: string, appId: string) => void) {
    await mkdir(paths.root, { recursive: true });
    let revision = 0;
    try {
      revision = parse(
        AppIndexSchema,
        JSON.parse(await readFile(paths.indexFile, 'utf8')),
      ).revision;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        warn('The app index could not be read; it is rewritten on the next change.', '');
    }
    const records = new Map<string, AppRecord>();
    for (const entry of await readdir(paths.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isAppId(entry.name)) continue;
      try {
        const record = readRecord(JSON.parse(await readFile(paths.appFile(entry.name), 'utf8')));
        if (record.id === entry.name) records.set(record.id, record);
      } catch {
        warn('An app record could not be read; the app is hidden and its files kept.', entry.name);
      }
    }
    return new AppStore(paths, revision, records);
  }

  get revision(): number {
    return this.revisionValue;
  }

  /** Calls `listener` after every landed change; answers the unsubscribe. */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Every app, most recently updated first. */
  list(): AppRecord[] {
    return [...this.records.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(appId: string): AppRecord {
    const record = this.records.get(appId);
    if (!record) throw appNotFound(appId);
    return structuredClone(record);
  }

  find(appId: string): AppRecord | undefined {
    const record = this.records.get(appId);
    return record && structuredClone(record);
  }

  /** The app a task's builds publish to: the one the task created (or was handed by `edit`). */
  bySourceTask(taskId: string): AppRecord | undefined {
    const record = this.list().find((item) => item.sourceTaskId === taskId);
    return record && structuredClone(record);
  }

  /**
   * Serializes one mutation of an app. `update` gets a draft (null for a new app id) and returns
   * the record to store. It may move a version into place first: it runs in the same turn as the
   * write, so no other change interleaves between the files and the record that names them.
   */
  change(
    appId: string,
    update: (draft: AppRecord | null) => AppRecord | Promise<AppRecord>,
  ): Promise<AppRecord> {
    return this.serialized(async () => {
      const current = this.records.get(appId);
      const next = parse(AppRecordSchema, await update(current ? structuredClone(current) : null));
      if (next.id !== appId) throw new Error('An app record cannot change its id.');
      await mkdir(this.paths.app(appId), { recursive: true });
      await atomicWrite(this.paths.appFile(appId), next);
      this.records.set(appId, next);
      await this.publish();
      return structuredClone(next);
    });
  }

  /** Removes the app's record and directory (its backend must be stopped first). */
  remove(appId: string): Promise<void> {
    return this.serialized(async () => {
      if (!this.records.has(appId)) throw appNotFound(appId);
      this.records.delete(appId);
      await this.publish();
      await rm(this.paths.app(appId), { recursive: true, force: true });
    });
  }

  /** Tells listeners about a change that lives outside the records (pending consents). */
  announce(): void {
    for (const listener of this.listeners) listener();
  }

  private async publish(): Promise<void> {
    this.revisionValue += 1;
    await atomicWrite(this.paths.indexFile, {
      version: 1,
      revision: this.revisionValue,
      apps: this.list().map(({ id, name, currentVersion, updatedAt }) => ({
        id,
        name,
        currentVersion,
        updatedAt,
      })),
    });
    this.announce();
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
