import { readFile } from 'node:fs/promises';
import {
  CURRENT_SESSION_VERSION,
  parseSessionEntries,
  SessionManager,
  type FileEntry,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';

/**
 * A session's current branch, read without writing: SessionManager.open appends a newline to an
 * unterminated last line, writes a header into an empty file and rewrites older-version files,
 * while the session may still be running. The branch is raw, pre-compaction messages included.
 * Null when the file does not exist yet (Pi writes it lazily), and empty when it holds no entries.
 */
export async function readSessionBranch(file: string): Promise<SessionEntry[] | null> {
  let content: string;
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const entries = parseSessionEntries(content);
  if (!entries.length) return [];
  if (entries[0]?.type !== 'session') throw new Error('The file is not a Pi session.');
  return SessionManager.inMemory(undefined, undefined, entries).getBranch();
}

/**
 * A session file loaded as SessionManager.open loads it (`loadEntriesFromFile`, `_setSessionFile`),
 * into an in-memory manager and without open's writes (see `readSessionBranch`), so a cold view of
 * the session matches what open would give. A missing or empty file loads as a new empty session,
 * and a non-empty one without a session header first is refused, as open refuses it. Null for a
 * file older than the current session version: open migrates it and persists the entry ids the
 * migration assigns, which views show and later reads must keep, so only open may load it.
 */
export async function readSessionManager(
  file: string,
  cwd: string,
): Promise<SessionManager | null> {
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const entries = sessionFileEntries(content);
  const [header] = entries;
  if (header?.type === 'session' && (header.version ?? 1) < CURRENT_SESSION_VERSION) return null;
  if (entries.length) return SessionManager.inMemory(cwd, undefined, entries);
  if (content) throw new Error(`Session file is not a valid session: ${file}`);
  return SessionManager.inMemory(cwd);
}

/**
 * `loadEntriesFromFile`'s parse: blank and malformed lines are skipped, and a file whose first
 * entry is not a session header holds none.
 */
function sessionFileEntries(content: string): FileEntry[] {
  // parseSessionEntries keeps a `null` line, which loadEntriesFromFile drops.
  const entries = parseSessionEntries(content).filter(Boolean);
  const [header] = entries;
  return header?.type === 'session' && typeof header.id === 'string' ? entries : [];
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
