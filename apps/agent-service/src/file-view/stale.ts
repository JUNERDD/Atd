import { sawCurrent, type SessionBranch } from './branch.js';
import type { Observed } from './call.js';
import {
  lastView,
  lastWriter,
  versionModified,
  versionOf,
  type FileVersion,
  type FileWriter,
  type ViewSession,
} from './ledger.js';

/** The write a check decides: its session, the path as the model wrote it, and its branch. */
export interface WriteCheck {
  session: ViewSession;
  shown: string;
  branch: SessionBranch;
}

/**
 * What a session's write may overwrite. A new file is always writable, and so is an existing file
 * whose current version is the one the session last saw, through any read or its own write or
 * edit. A file the ledger holds no view of for the session (none was taken since the service
 * started, or the ledger's bounds dropped it) is writable when the session's branch shows a read,
 * write or edit of it from after its last change (branch.ts). Otherwise the write is refused, with
 * a message telling the model what to do: an existing file it has not seen as it is now could hold
 * content the write would lose. An edit is never refused here, since it matches the current
 * content; it only reports a change (`changedNote`).
 */
export async function assertWritable(write: WriteCheck, real: string): Promise<void> {
  const { session, shown } = write;
  const current = await versionOf(real);
  if (current === null) return;
  const view = lastView(session, real);
  if (!view) {
    if (await sawCurrent(write.branch, real, versionModified(current))) return;
    // The conversation may have read it before the service restarted: no claim it never did.
    throw new Error(
      `${shown} already exists, and this conversation has not read it since it last changed. Read it first, or write to a new path.`,
    );
  }
  if (view.version !== current) {
    const sentence = changed(session, current, lastWriter(session.taskId, real), shown);
    throw new Error(`${sentence} Read it again before overwriting it.`);
  }
}

/**
 * The sentence an edit adds when the version it read is not the one the session saw last before
 * the call; null when it is, or when the session had not seen the file. `seen` is taken before the
 * edit wrote anything, so its own write never hides who changed the file before it.
 */
export function changedNote(
  session: ViewSession,
  seen: Observed,
  shown: string,
  outcome: 'applied' | 'failed',
): string | null {
  if (seen.prior === null || seen.prior === seen.version) return null;
  const sentence = changed(session, seen.version, seen.writer, shown);
  return outcome === 'applied'
    ? `Note: ${sentence} The edit matched its current content.`
    : `${sentence} Read it again before retrying.`;
}

/**
 * Says the file changed since the session's last view, naming who changed it when this task's own
 * write or edit tools did and produced exactly the `current` version: the parent or another child.
 * Anything else changed it outside this conversation's write and edit: a command (the model's own
 * shell commands included), another app or the user.
 */
function changed(
  session: ViewSession,
  current: FileVersion | null,
  writer: FileWriter | undefined,
  shown: string,
): string {
  const known = current !== null && writer?.version === current && writer.session !== session.id;
  if (known && writer.role === 'child')
    return `${shown} was changed by ${session.role === 'child' ? 'another subagent' : 'a subagent'} of this task since you last read it.`;
  if (known && session.role === 'child')
    return `${shown} was changed by the main agent of this task since you last read it.`;
  return `${shown} was changed outside this conversation's write and edit calls (by a command, an app or the user) since you last read it.`;
}
