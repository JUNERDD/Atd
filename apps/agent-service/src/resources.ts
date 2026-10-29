import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { MAX_ATTACHMENT_BYTES, type ResourceRef } from '@atd/agent-contracts';
import { Ledger, LedgerNotFound } from './ledger.js';
import type { ServicePaths } from './storage.js';

const MIB = 1024 * 1024;

/** A resource to store: the name and media type it is shown with, its bytes and its task. */
export interface NewResource {
  name: string;
  mime: string;
  bytes: Uint8Array;
  taskId?: string;
}

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

  async save(options: NewResource): Promise<ResourceRef> {
    const resource = await this.write(options);
    await this.register([resource]);
    return resource;
  }

  /**
   * Stores every file `files` yields, or none. Each is written as it arrives, so one file at a
   * time is held in memory, and the ledger records them all in one change once the last is
   * written. When `files` throws, the files written so far are removed and the error passes on.
   */
  async saveAll(files: AsyncIterable<NewResource>): Promise<ResourceRef[]> {
    const written: ResourceRef[] = [];
    try {
      for await (const file of files) written.push(await this.write(file));
    } catch (error) {
      // Nothing refers to them yet; a file that cannot be removed stays behind unreferenced.
      await Promise.allSettled(written.map(({ id }) => rm(this.pathOf(id), { force: true })));
      throw error;
    }
    await this.register(written);
    return written;
  }

  /** The file holding resource `id`, as the model reads it with the read tool. */
  pathOf(id: string): string {
    return path.join(this.paths.resourcesDir, id);
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
        const resource = this.ledger.data.resources.find((item) => item.id === id);
        // A resource saved for another task stays that task's, even when attached here.
        if (!resource || (resource.taskId !== null && resource.taskId !== taskId)) return false;
        if (resource.taskId === taskId) return true;
        const task = this.ledger.data.tasks.find((item) => item.id === taskId);
        return Boolean(
          task?.runs.some((run) => run.snapshot.input.files.some((file) => file.id === id)),
        );
      },
      hint: (id) => {
        const resource = this.ledger.data.resources.find((item) => item.id === id);
        return resource && { name: resource.name, mime: resource.mime };
      },
    };
  }

  /**
   * Download choke point (T6b). Missing resources and task-scoped resources
   * whose task is gone both answer 404; bytes never ride a JSON envelope.
   */
  async readBytes(id: string): Promise<{ resource: ResourceRef; bytes: Uint8Array }> {
    const resource = this.ledger.data.resources.find((item) => item.id === id);
    if (!resource) throw new LedgerNotFound('Resource', id);
    if (resource.taskId && !this.ledger.data.tasks.some((task) => task.id === resource.taskId))
      throw new LedgerNotFound('Resource', id);
    const bytes = await readFile(path.join(this.paths.resourcesDir, id));
    return { resource, bytes: new Uint8Array(bytes) };
  }

  /** Writes a new resource's file; no run can reference it until `register` records it. */
  private async write(options: NewResource): Promise<ResourceRef> {
    // The attachment limit is the store's cap, so any file a user can attach fits.
    if (options.bytes.length > MAX_ATTACHMENT_BYTES)
      throw new Error(`The resource exceeds the ${MAX_ATTACHMENT_BYTES / MIB} MiB upload limit.`);
    const id = randomUUID();
    await mkdir(this.paths.resourcesDir, { recursive: true });
    const handle = await open(this.pathOf(id), 'wx', 0o600);
    try {
      await handle.writeFile(options.bytes);
    } finally {
      await handle.close();
    }
    return {
      id,
      name: options.name.slice(0, 255),
      size: options.bytes.length,
      mime: options.mime.slice(0, 100),
      taskId: options.taskId ?? null,
      createdAt: new Date().toISOString(),
    };
  }

  private async register(resources: ResourceRef[]): Promise<void> {
    await this.ledger.change((data) => {
      data.resources.push(...resources);
    });
  }
}
