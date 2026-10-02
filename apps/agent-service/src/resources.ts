import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResourceRef } from '@ai/agent-contracts';
import { Ledger, LedgerNotFound } from './ledger.js';
import type { ServicePaths } from './storage.js';

const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

/**
 * One task's view of the resource store: where resource files live (a resource's file is
 * `<dir>/<id>`) and which resources belong to the task. The parent read tool reads those without
 * a confirmation (tool-proxies.ts); every other resource reads as any other data-dir file.
 */
export interface TaskResources {
  dir: string;
  owns(id: string): boolean;
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

  async save(options: {
    name: string;
    mime: string;
    bytes: Uint8Array;
    taskId?: string;
  }): Promise<ResourceRef> {
    if (options.bytes.length > MAX_RESOURCE_BYTES)
      throw new Error('The resource exceeds the 8 MiB upload limit.');
    const id = randomUUID();
    const file = path.join(this.paths.resourcesDir, id);
    await mkdir(this.paths.resourcesDir, { recursive: true });
    const handle = await open(file, 'wx', 0o600);
    try {
      await handle.writeFile(options.bytes);
    } finally {
      await handle.close();
    }
    const resource: ResourceRef = {
      id,
      name: options.name.slice(0, 255),
      size: options.bytes.length,
      mime: options.mime.slice(0, 100),
      taskId: options.taskId ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.ledger.change((data) => {
      data.resources.push(resource);
    });
    return resource;
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
}
