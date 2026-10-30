import path from 'node:path';
import { attachmentMime, type ResourceImportResponse } from '@atd/agent-contracts';
import type { ResourceStore } from '../resources.js';
import { AttachableRejected, inspectAttachable, readInspected } from './attachable-read.js';
import { ResourceBatch } from './batch.js';

type Failure = ResourceImportResponse['failures'][number];

/**
 * Stores each file the shell named as a resource, under the attachment rules, in one ledger
 * change. Paths are independent: a refused file lands in `failures` and the others still import.
 * A file the store already holds unchanged is not read or copied again (ResourceStore.save).
 * Resources carry no task id, so any later run can reference them.
 *
 * When storing fails partway (a full disk, a ledger write), nothing of the batch stays: the
 * files it wrote are removed and every path lands in `failures`, refused ones with their own
 * reason and the rest as `unreadable`, named only by basename and the error's code.
 */
export async function importResources(
  store: Pick<ResourceStore, 'save'>,
  paths: string[],
): Promise<ResourceImportResponse> {
  // A relative path would resolve against the service's working directory, never the caller's.
  if (!paths.every((filePath) => path.isAbsolute(filePath)))
    throw new TypeError('Invalid data: every path must be absolute.');
  const batch = new ResourceBatch();
  const reply: ResourceImportResponse = { imported: [], failures: [] };
  try {
    for (const filePath of paths) {
      try {
        const file = await inspectAttachable(filePath);
        const resource = await store.save(
          {
            name: file.name,
            mime: attachmentMime(file.name),
            ...(file.source ? { source: file.source } : {}),
            read: () => readInspected(file),
          },
          batch,
        );
        reply.imported.push({ path: filePath, resource });
      } catch (error) {
        if (!(error instanceof AttachableRejected)) throw error;
        reply.failures.push({ path: filePath, reason: error.reason, message: error.message });
      }
    }
    await batch.commit();
  } catch (error) {
    await batch.discard();
    const refused = new Map(reply.failures.map((failure) => [failure.path, failure]));
    return {
      imported: [],
      failures: paths.map((filePath) => refused.get(filePath) ?? notStored(filePath, error)),
    };
  }
  return reply;
}

/** A path the batch would have imported, had storing not failed. */
function notStored(filePath: string, error: unknown): Failure {
  // Node's fs errors embed absolute paths: only the code, such as ENOSPC, goes on.
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  const cause = typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code) ? ` (${code})` : '';
  return {
    path: filePath,
    reason: 'unreadable',
    message: `${path.basename(filePath)} could not be stored${cause}.`,
  };
}
