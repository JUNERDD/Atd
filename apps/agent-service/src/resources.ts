import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ResourceRef } from '@ai/agent-contracts';
import { Ledger, LedgerNotFound } from './ledger.js';
import type { ServicePaths } from './storage.js';

const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;

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
