import path from 'node:path';
import type { ResourceImportResponse } from '@atd/agent-contracts';
import type { ResourceStore } from '../resources.js';
import { AttachableRejected, readAttachable } from './attachable-read.js';

/**
 * Stores each file the shell named as a resource, under the attachment rules. Paths are
 * independent: a refused file lands in `failures` and the others still import. Resources carry
 * no task id, so any later run can reference them.
 */
export async function importResources(
  store: Pick<ResourceStore, 'save'>,
  paths: string[],
): Promise<ResourceImportResponse> {
  // A relative path would resolve against the service's working directory, never the caller's.
  if (!paths.every((filePath) => path.isAbsolute(filePath)))
    throw new TypeError('Invalid data: every path must be absolute.');
  const reply: ResourceImportResponse = { imported: [], failures: [] };
  for (const filePath of paths) {
    try {
      const { name, mime, bytes } = await readAttachable(filePath);
      reply.imported.push({ path: filePath, resource: await store.save({ name, mime, bytes }) });
    } catch (error) {
      if (!(error instanceof AttachableRejected)) throw error;
      reply.failures.push({ path: filePath, reason: error.reason, message: error.message });
    }
  }
  return reply;
}
