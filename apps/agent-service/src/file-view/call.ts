import { AsyncLocalStorage } from 'node:async_hooks';
import { realpath } from 'node:fs/promises';
import {
  lastView,
  lastWriter,
  recordWrite,
  versionOf,
  type FileVersion,
  type FileWriter,
  type ViewSession,
} from './ledger.js';
import type { SessionBranch } from './branch.js';
import { replaceFile } from './replace.js';
import { assertWritable } from './stale.js';

/** One read, write or edit call as the ledger follows it into pi's file operations. */
export interface ViewCall {
  session: ViewSession;
  tool: 'read' | 'write' | 'edit';
  /** The model-issued call the views it records hang on (`FileView.anchor`). */
  anchor: string;
  /** The call's `path` argument as the model wrote it, for messages. */
  shown: string;
  /** The session's branch, which a write over a file the ledger has no view of consults. */
  branch: SessionBranch;
  /**
   * The first file the call's operations resolved, as it was at that moment: what a read returned
   * or an edit matched against.
   */
  observed?: Observed;
}

/** One file as a call's operations first resolved it, before the call wrote anything. */
export interface Observed {
  real: string;
  version: FileVersion | null;
  /** The session's view of the file then. */
  prior: FileVersion | null;
  /** The file's last writer then, which names who made `version` (stale.ts). */
  writer: FileWriter | undefined;
}

const calls = new AsyncLocalStorage<ViewCall>();

/** Runs a tool's own execution as `call`, so the operations below know whose call they serve. */
export function runViewCall<T>(call: ViewCall, run: () => T): T {
  return calls.run(call, run);
}

/** Resolves a tool path to the real path an operation may touch, or throws to refuse it. */
type Resolve = (target: string) => Promise<string>;

/**
 * `resolve`, noting the first file the current call resolves: pi's read and edit resolve their
 * file (`access`) before they read it, so its version then is the version they read.
 */
export function observedPath(resolve: Resolve): Resolve {
  return async (target) => {
    const real = await resolve(target);
    const call = calls.getStore();
    if (call && !call.observed) {
      const prior = lastView(call.session, real)?.version ?? null;
      const writer = lastWriter(call.session.taskId, real);
      call.observed = { real, version: await versionOf(real), prior, writer };
    }
    return real;
  };
}

/**
 * The write step of the write and edit tools, for the parent and every child (tool-proxies.ts
 * `WriteResolved`). pi runs it inside its per-file mutation queue, which `withFileMutationQueue`
 * holds around each write and edit call whole, so nothing else writing the file through these
 * tools comes between the check here and the write. A write is refused unless the session saw the
 * file's current version (stale.ts); an edit is refused when its file changed after it read it,
 * which only a writer outside the queue can do, since writing would drop that change. The file is
 * replaced atomically (replace.ts), and the version written becomes the session's view of the
 * file and the file's last writer.
 */
export async function viewedReplace(real: string, content: string): Promise<void> {
  const call = calls.getStore();
  if (!call) throw new Error('A file write requires a file tool call.');
  if (call.tool === 'write') await assertWritable(call, real);
  else if (
    call.observed &&
    (call.observed.real !== real || (await versionOf(real)) !== call.observed.version)
  )
    throw new Error(
      `${call.shown} changed while it was being edited, so nothing was written. Read it again and retry.`,
    );
  await replaceFile(real, content);
  const written = await realpath(real).catch(() => null);
  const version = written === null ? null : await versionOf(written);
  if (written !== null && version !== null)
    recordWrite(call.session, written, version, call.anchor);
}
