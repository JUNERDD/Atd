import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_ATTACHMENT_BYTES,
  type ResourceRef,
  type ResourceSource,
  type StoredResource,
} from '@atd/agent-contracts';
import { Ledger, LedgerNotFound } from './ledger.js';
import { ResourceBatch } from './resources/batch.js';
import { storedMime } from './resources/media-type.js';
import { sameVersion, toRef } from './resources/stored.js';
import type { ServicePaths } from './storage.js';

const MIB = 1024 * 1024;

/**
 * A resource to store: the name it is shown with, its bytes and its task. Without a task it is a
 * shared attachment, which any run may send and which is stored once per content.
 */
export type NewResource = {
  name: string;
  /**
   * The media type the caller names. A shared resource is stored with the one its content shows
   * instead, and with this one only when neither its content nor its name settles it
   * (resources/media-type.ts).
   */
  mime: string;
  taskId?: string;
  /**
   * The file a shared attachment is read from (resources/attachable-read.ts). A resource read from
   * it while it was in this same version is reused without reading the file again, and a run sent
   * later reads the file again once it changed (resources/refresh.ts).
   */
  source?: ResourceSource;
} & (
  | { bytes: Uint8Array }
  /** Reads the bytes, which the store does only when no stored resource already holds them. */
  | { read: () => Promise<Uint8Array> }
);

/**
 * One task's view of the resource store: where resource files live (a resource's file is
 * `<dir>/<id>`) and which resources belong to the task. The parent read tool reads those without
 * a confirmation (tool-proxies.ts); every other resource reads as any other data-dir file.
 */
export interface TaskResources {
  dir: string;
  owns(id: string): boolean;
  /**
   * The name and media type resource `id` was stored with, which its file's name does not carry:
   * the read tool loads a resource as the run's attachment material did (file-loader/read-tool.ts).
   */
  hint(id: string): { name: string; mime: string } | undefined;
}

/**
 * Uploaded bytes referenced by runs. Binaries stay out of the WS stream;
 * the runner reads them from disk as read-only task material.
 */
export class ResourceStore {
  constructor(
    private readonly ledger: Ledger,
    private readonly paths: ServicePaths,
  ) {}

  /**
   * Stores a resource. A shared one that a stored shared resource of the same name and media type
   * already holds (the same content, or its unchanged source) is not stored again: that resource
   * is reused and handed out anew. With `batch`, the ledger records the resource only when the
   * batch is recorded, together with the rest of it; without, at once.
   */
  async save(options: NewResource, batch?: ResourceBatch): Promise<ResourceRef> {
    if (batch) return this.stage(options, batch);
    const own = new ResourceBatch();
    const saved = await this.stage(options, own);
    await own.commit();
    return saved;
  }

  /**
   * Stores every file `files` yields, or none. Each is written as it arrives, so one file at a
   * time is held in memory, and the ledger records them all in one change once the last is
   * written. When `files` throws, the files written so far are removed and the error passes on.
   */
  async saveAll(files: AsyncIterable<NewResource>): Promise<ResourceRef[]> {
    const batch = new ResourceBatch();
    const saved: ResourceRef[] = [];
    try {
      for await (const file of files) saved.push(await this.stage(file, batch));
    } catch (error) {
      await batch.discard();
      throw error;
    }
    await batch.commit();
    return saved;
  }

  /** The file holding resource `id`, as the model reads it with the read tool. */
  pathOf(id: string): string {
    return path.join(this.paths.resourcesDir, id);
  }

  /** Resource `id`'s ledger row, with what only the service keeps (its source). */
  stored(id: string): StoredResource | undefined {
    return this.ledger.data.resources.find((item) => item.id === id);
  }

  /**
   * `taskId`'s resources: those saved for it (codemode's spilled output, an MCP result's whole
   * text or binary content) and the uploaded files attached to one of its runs. Decided from the ledger on
   * every call, so a resource saved mid-run counts at once.
   */
  forTask(taskId: string): TaskResources {
    return {
      dir: this.paths.resourcesDir,
      owns: (id) => {
        const resource = this.stored(id);
        // A resource saved for another task stays that task's, even when attached here.
        if (!resource || (resource.taskId !== null && resource.taskId !== taskId)) return false;
        if (resource.taskId === taskId) return true;
        const task = this.ledger.data.tasks.find((item) => item.id === taskId);
        return Boolean(
          task?.runs.some((run) => run.snapshot.input.files.some((file) => file.id === id)),
        );
      },
      hint: (id) => {
        const resource = this.stored(id);
        return resource && { name: resource.name, mime: resource.mime };
      },
    };
  }

  /**
   * Download choke point (T6b). Missing resources and task-scoped resources
   * whose task is gone both answer 404; bytes never ride a JSON envelope.
   */
  async readBytes(id: string): Promise<{ resource: ResourceRef; bytes: Uint8Array }> {
    const resource = this.stored(id);
    if (!resource) throw new LedgerNotFound('Resource', id);
    if (resource.taskId && !this.ledger.data.tasks.some((task) => task.id === resource.taskId))
      throw new LedgerNotFound('Resource', id);
    const bytes = await readFile(path.join(this.paths.resourcesDir, id));
    return { resource: toRef(resource), bytes: new Uint8Array(bytes) };
  }

  /** Stages one resource in `batch`: a reused stored one, or a file written for it. */
  private async stage(options: NewResource, batch: ResourceBatch): Promise<ResourceRef> {
    batch.claim(this.ledger, this.paths.resourcesDir);
    const { source, taskId } = options;
    const name = options.name.slice(0, 255);
    if (taskId !== undefined) {
      const bytes = 'bytes' in options ? options.bytes : await options.read();
      return batch.add(await this.write(bytes, { name, mime: options.mime, taskId }));
    }
    if (source) {
      const known = await this.find(batch, (row) => {
        return row.name === name && row.source !== undefined && sameVersion(row.source, source);
      });
      if (known) return batch.reuse(known);
    }
    const bytes = 'bytes' in options ? options.bytes : await options.read();
    const mime = storedMime(bytes, name, options.mime).slice(0, 100);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // Content read from a file matches only a copy of that file or one of no file: a copy of a
    // namesake elsewhere would make a run sent later follow the other file.
    const known = await this.find(
      batch,
      (row) =>
        row.sha256 === sha256 &&
        row.name === name &&
        row.mime === mime &&
        (source ? !row.source || row.source.path === source.path : !row.source),
    );
    if (known) return batch.reuse(known, source);
    return batch.add(
      await this.write(bytes, { name, mime, sha256, ...(source ? { source } : {}) }),
    );
  }

  /**
   * The newest shared resource `match` accepts whose file is still stored, among `batch`'s own
   * first. One whose file is missing or another size (removed or changed outside the service) is
   * never reused.
   */
  private async find(
    batch: ResourceBatch,
    match: (row: StoredResource) => boolean,
  ): Promise<StoredResource | undefined> {
    const staged = batch.rows().find((row) => row.taskId === null && match(row));
    if (staged) return staged;
    const rows = this.ledger.data.resources;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (!row || row.taskId !== null || !match(row)) continue;
      const info = await stat(this.pathOf(row.id)).catch(() => null);
      if (info?.isFile() && info.size === row.size) return row;
    }
    return undefined;
  }

  /** Writes a new resource's file; no run can reference it until its batch is recorded. */
  private async write(
    bytes: Uint8Array,
    fields: Omit<StoredResource, 'id' | 'size' | 'taskId' | 'createdAt'> & { taskId?: string },
  ): Promise<StoredResource> {
    // The attachment limit is the store's cap, so any file a user can attach fits.
    if (bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error(`The resource exceeds the ${MAX_ATTACHMENT_BYTES / MIB} MiB upload limit.`);
    const id = randomUUID();
    await mkdir(this.paths.resourcesDir, { recursive: true });
    const file = this.pathOf(id);
    const handle = await open(file, 'wx', 0o600);
    let written = false;
    try {
      await handle.writeFile(bytes);
      written = true;
    } finally {
      await handle.close();
      // A partial file (a full disk) would otherwise wait for the sweep (resources/gc.ts).
      if (!written) await rm(file, { force: true });
    }
    const { taskId, ...rest } = fields;
    return {
      ...rest,
      id,
      size: bytes.length,
      mime: fields.mime.slice(0, 100),
      taskId: taskId ?? null,
      createdAt: new Date().toISOString(),
    };
  }
}
