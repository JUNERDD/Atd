import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { errorMessage, MAX_ATTACHMENT_BYTES } from '@atd/agent-contracts';
import type { Logger } from './logging.js';
import type { ResourceStore } from './resources.js';

/** The resource store's size limit, as a tool result names it. */
export const RESOURCE_LIMIT = `${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB`;

/**
 * Where a tool's spilled output is kept: the task's resources, files the read tool and grep reach
 * without a confirmation (tool-proxies.ts, harness/search-tools.ts) and that go with the task.
 */
export interface SpillHost {
  taskId: string;
  resources: Pick<ResourceStore, 'save'>;
  /** The resource store's directory; a saved resource's file is `<resourcesDir>/<id>`. */
  resourcesDir: string;
  log: Pick<Logger, 'warn'>;
}

/** One kind of pi output file (`utils/output-files.js`: `<tmpdir>/<prefix>-<hex><extension>`). */
export interface SpillKind {
  /** The file name pi gives it. */
  file: RegExp;
  /** The name and media type the resource is saved with, which `read` loads it by. */
  name: string;
  mime: string;
  /** What the log calls the output when it cannot be kept. */
  label: string;
  /**
   * Set for output a tool of the run can still open where pi wrote it (bash's): over the resource
   * limit, pi's file stays there instead of being removed. Unset, it is removed like the rest.
   */
  leaveOversize?: true;
}

/**
 * Where a spill's full text is: in the task's resources, or, for a kind that leaves output over
 * the resource limit, still in pi's file (`tooLarge`); why it is gone; or null for a path that is
 * not pi's output file.
 */
export type KeptSpill = { path: string; tooLarge?: true } | { error: string } | null;

/**
 * Moves pi's output file `spilled` into the task's resources and answers where it now is. pi
 * writes the full text of output it cut to the system temp dir, which the read tool refuses and
 * which outlives the task. Only a file of `kind` directly in that dir is read, so a path from
 * anywhere else is never copied or removed (null). pi's file is removed whether or not it was
 * kept, except output over the resource limit of a kind that leaves it (`leaveOversize`).
 */
export async function keepSpill(
  host: SpillHost,
  spilled: string,
  kind: SpillKind,
): Promise<KeptSpill> {
  const resolved = path.resolve(spilled);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !kind.file.test(path.basename(resolved)))
    return null;
  // A file the store cannot take is not read into memory.
  const oversize = await stat(resolved).then(
    (info) => info.size > MAX_ATTACHMENT_BYTES,
    () => false,
  );
  if (oversize && kind.leaveOversize) {
    host.log.warn(`${kind.label} is over the resource limit; it stays where pi wrote it.`, {
      taskId: host.taskId,
    });
    return { path: resolved, tooLarge: true };
  }
  try {
    if (oversize) throw new Error(`It is larger than the ${RESOURCE_LIMIT} resource limit.`);
    const resource = await host.resources.save({
      name: kind.name,
      mime: kind.mime,
      bytes: new Uint8Array(await readFile(resolved)),
      taskId: host.taskId,
    });
    return { path: path.join(host.resourcesDir, resource.id) };
  } catch (error) {
    host.log.warn(`${kind.label} could not be kept.`, {
      taskId: host.taskId,
      error: errorMessage(error),
    });
    return { error: errorMessage(error) };
  } finally {
    await rm(resolved, { force: true });
  }
}
