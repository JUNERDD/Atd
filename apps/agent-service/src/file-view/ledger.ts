import { stat } from 'node:fs/promises';

/**
 * The File View Ledger: which version of each file every session of a task last saw, in memory
 * only (a restart clears it), keyed by real path. A task's parent session and its subagent
 * children share one task entry, as they share its folder: a child's write makes the parent's view
 * stale. stale.ts decides writes from it, and from the session's branch for a file it holds no view
 * of (branch.ts); reread.ts answers repeated reads from it, and call.ts records what the file tools
 * read and write.
 *
 * Pi loads the subagent bridge through its own loader, so the store lives on `globalThis` under a
 * versioned symbol, where both loader instances meet (as subagents/registry.ts does).
 */

/**
 * One version of a file: its size, its modification time in nanoseconds and its inode, so a
 * rewrite in place makes a new version, and so does a file replaced by a rename (a new inode). The
 * status-change time is left out: macOS changes it whenever an app merely opens a document and
 * updates its extended attributes, which would count as a change the model never saw. A tool that
 * changes a file in place without changing its size, then sets its modification time back, still
 * goes unnoticed.
 */
export type FileVersion = string;

/** The version of the regular file at `real`; null when it is missing or not a regular file. */
export async function versionOf(real: string): Promise<FileVersion | null> {
  try {
    const info = await stat(real, { bigint: true });
    return info.isFile() ? `${info.size}:${info.mtimeNs}:${info.ino}` : null;
  } catch {
    return null;
  }
}

/** The size in bytes a version records. */
export function versionSize(version: FileVersion): number {
  return Number(version.slice(0, version.indexOf(':')));
}

/** The modification time a version records, in nanoseconds since the epoch. */
export function versionModified(version: FileVersion): bigint {
  const start = version.indexOf(':') + 1;
  return BigInt(version.slice(start, version.indexOf(':', start)));
}

/** Who a session is in its task: the conversation the user talks to, or one subagent child. */
export type ViewRole = 'parent' | 'child';

/** One session of a task: its pi session id and role. */
export interface ViewSession {
  taskId: string;
  id: string;
  role: ViewRole;
}

/**
 * Lines `from`–`to` (1-based and inclusive; `to` is Infinity for "through the end") of one
 * version that a read the model issued itself returned, with that call's id and a digest of the
 * result text, so reread.ts can find the result again and tell whether it is still intact.
 */
export interface ReadRange {
  from: number;
  to: number;
  toolCallId: string;
  digest: string;
  /** The call's other arguments (all but path, offset and limit), as reread.ts keys them. */
  extra: string;
}

/** What one session last saw of one file. */
export interface FileView {
  version: FileVersion;
  /**
   * The model-issued call that saw it: the read, write or edit itself, or the codemode call whose
   * script made it. A view whose call left the session's branch (a rewind) is dropped.
   */
  anchor: string;
  /** What reads of this version returned, newest last. Writes and edits add none. */
  ranges: ReadRange[];
}

/** Who last changed a file through this task's write or edit, and the version that made. */
export interface FileWriter {
  session: string;
  role: ViewRole;
  version: FileVersion;
}

interface FileEntry {
  views: Map<string, { role: ViewRole; view: FileView }>;
  writer?: FileWriter;
}

/**
 * Bounds: tasks and files are dropped least recently used first, views and ranges oldest first.
 * A dropped task's sessions overwrite a file only when their branch shows they saw it as it is
 * (stale.ts), and they lose their repeated-read stubs, so the task bound outlasts a day of short
 * tasks, such as an automation firing every 15 minutes, beside a conversation the user keeps open.
 */
const MAX_TASKS = 64;
const MAX_FILES = 256;
const MAX_SESSIONS = 4;
const MAX_RANGES = 8;

const STORE_KEY = Symbol.for('ai.agent-service.file-views.v1');

type Store = Map<string, Map<string, FileEntry>>;

function store(): Store {
  const global = globalThis as Record<symbol, Store | undefined>;
  const existing = global[STORE_KEY];
  if (existing) return existing;
  const created: Store = new Map();
  global[STORE_KEY] = created;
  return created;
}

/** Moves `key` to the most recent end of `map` and drops the oldest entries over `max`. */
function touch<K, V>(map: Map<K, V>, key: K, value: V, max: number): V {
  map.delete(key);
  map.set(key, value);
  for (const oldest of map.keys()) {
    if (map.size <= max) break;
    map.delete(oldest);
  }
  return value;
}

function fileEntry(taskId: string, real: string, create: boolean): FileEntry | undefined {
  const tasks = store();
  const files = tasks.get(taskId) ?? (create ? new Map<string, FileEntry>() : undefined);
  if (!files) return undefined;
  touch(tasks, taskId, files, MAX_TASKS);
  const entry = files.get(real) ?? (create ? { views: new Map() } : undefined);
  return entry && touch(files, real, entry, MAX_FILES);
}

/**
 * Sets one session's view. Over the bound, the oldest view of another session goes, a child's
 * before the parent's: the parent's conversation outlives each child.
 */
function putView(entry: FileEntry, session: ViewSession, view: FileView): void {
  entry.views.delete(session.id);
  entry.views.set(session.id, { role: session.role, view });
  if (entry.views.size <= MAX_SESSIONS) return;
  const others = [...entry.views].filter(([id]) => id !== session.id);
  const victim = others.find(([, held]) => held.role === 'child') ?? others[0];
  if (victim) entry.views.delete(victim[0]);
}

/** What `session` last saw of the file at `real`. */
export function lastView(session: ViewSession, real: string): FileView | undefined {
  return fileEntry(session.taskId, real, false)?.views.get(session.id)?.view;
}

/**
 * Records that `session` saw `version` of the file at `real` through a read, with what the read
 * returned when reread.ts can use it. Ranges of an earlier version are dropped with its view.
 */
export function recordRead(
  session: ViewSession,
  real: string,
  version: FileVersion,
  anchor: string,
  range: ReadRange | null,
): void {
  const entry = fileEntry(session.taskId, real, true);
  if (!entry) return;
  const held = entry.views.get(session.id)?.view;
  const ranges = held?.version === version ? held.ranges : [];
  const kept = range ? [...ranges, range].slice(-MAX_RANGES) : ranges;
  putView(entry, session, { version, anchor, ranges: kept });
}

/** Records that `session` wrote `version` of the file at `real` (write or edit). */
export function recordWrite(
  session: ViewSession,
  real: string,
  version: FileVersion,
  anchor: string,
): void {
  const entry = fileEntry(session.taskId, real, true);
  if (!entry) return;
  putView(entry, session, { version, anchor, ranges: [] });
  entry.writer = { session: session.id, role: session.role, version };
}

/**
 * Records files another tool of `session` created for it, such as an app scaffold's starter
 * files: as after its own write, its next write over one needs no read first. A file already gone
 * is skipped.
 */
export async function recordCreated(
  session: ViewSession,
  reals: readonly string[],
  anchor: string,
): Promise<void> {
  for (const real of reals) {
    const version = await versionOf(real);
    if (version !== null) recordWrite(session, real, version, anchor);
  }
}

/** Who last changed the file at `real` through this task's write or edit tools. */
export function lastWriter(taskId: string, real: string): FileWriter | undefined {
  return fileEntry(taskId, real, false)?.writer;
}

/**
 * Keeps only the views of `session` whose anchor is still one of `anchors`, the calls on its
 * current branch: after a rewind, what the abandoned turns saw no longer counts.
 */
export function retainViews(session: ViewSession, anchors: ReadonlySet<string>): void {
  const files = store().get(session.taskId);
  if (!files) return;
  for (const entry of files.values()) {
    const held = entry.views.get(session.id);
    if (held && !anchors.has(held.view.anchor)) entry.views.delete(session.id);
  }
}
