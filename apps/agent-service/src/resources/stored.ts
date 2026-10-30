import type { LedgerData, ResourceRef, ResourceSource, StoredResource } from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';

/** A stored resource as clients receive it: without its source path, hash or handout time. */
export function toRef(row: StoredResource): ResourceRef {
  const { id, name, size, mime, taskId, createdAt } = row;
  return { id, name, size, mime, taskId, createdAt };
}

/** Whether two sources are the same file in the same version. */
export function sameVersion(a: ResourceSource, b: ResourceSource): boolean {
  return (
    a.path === b.path &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs &&
    a.ino === b.ino
  );
}

/**
 * Whether resource `id` can still be read in `data`: it has a row, and a task-scoped one's task
 * still exists. The download route and run loading refuse any other (ResourceStore.readBytes).
 */
export function isLive(data: LedgerData, id: string): boolean {
  const row = data.resources.find((item) => item.id === id);
  return Boolean(row && (row.taskId === null || data.tasks.some((task) => task.id === row.taskId)));
}

/**
 * 409: a run names an attachment the service no longer holds, removed by garbage collection
 * (gc.ts) or outside the service. The first sentence is the whole message, since the panel shows
 * only that much of an error.
 */
export class ResourceGone extends ConflictError {
  constructor(name: string) {
    super(`Attach ${name} again: the stored copy is no longer available.`);
    this.name = 'ResourceGone';
  }
}
