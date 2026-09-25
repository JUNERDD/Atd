import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  parseSessionEntries,
  SessionManager,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import {
  parseChildExecutionId,
  subagentChildKey,
  type ChildTranscriptResponse,
  type SubagentChildEntry,
} from '@ai/agent-contracts';
import type { Logger } from '../logging.js';
import { inside } from '../service-fs.js';
import { collectBlockLookups } from '../transcript-blocks.js';
import { fromServiceBranch, projectServiceBlocks } from '../transcript.js';
import { liveChildTranscript } from './child-transcript.js';

export interface ChildTranscriptQuery {
  taskId: string;
  /** `<toolCallId>:<seq>`, as the client sent it; only an `app-child` entry resolves it. */
  childKey: string;
  /** The parent task's session file. */
  parentSessionFile: string;
  /** The running parent's branch; without it the parent session file is read. */
  parentBranch?: () => SessionEntry[];
  log: Pick<Logger, 'warn'>;
}

/**
 * One child's transcript for `GET /v1/tasks/:taskId/children/:childKey/transcript`. The child is
 * found only through the parent session's `app-child` entry with that key, never a client path,
 * and its session file must resolve inside the child root pi-subagents derives from the parent
 * session file. A running child answers its live snapshot; an ended one the cold projection of
 * its JSONL with the parent's recorded approvals joined in. Null when the task has no such child.
 */
export async function readChildTranscript(
  query: ChildTranscriptQuery,
): Promise<ChildTranscriptResponse | null> {
  const { childKey } = query;
  const parentEntries = query.parentBranch
    ? query.parentBranch()
    : await readSessionBranch(query.parentSessionFile);
  if (!parentEntries) return null;
  const lookups = collectBlockLookups(fromServiceBranch(parentEntries));
  const entry = findChild(lookups.children.values(), childKey);
  const parentRunId = entry ? parseChildExecutionId(entry.executionId)?.parentRunId : undefined;
  if (!entry || !parentRunId) return null;
  const sessionFile = await containedChildFile(query.parentSessionFile, entry.sessionFile);
  if (!sessionFile) {
    query.log.warn('A child session file lies outside its parent child root.', {
      taskId: query.taskId,
      childKey,
    });
    return null;
  }
  const live = liveChildTranscript(query.taskId, childKey);
  if (live) return { childKey, revision: live.revision, live: true, blocks: live.blocks };
  const branch = await readSessionBranch(sessionFile);
  const blocks = branch
    ? projectServiceBlocks({
        branch: fromServiceBranch(branch),
        firstRunId: parentRunId,
        live: false,
        permissions: lookups.permissions,
      })
    : [];
  return { childKey, revision: 0, live: false, blocks };
}

function findChild(
  groups: Iterable<readonly SubagentChildEntry[]>,
  childKey: string,
): SubagentChildEntry | undefined {
  for (const group of groups) {
    const entry = group.find((item) => subagentChildKey(item.toolCallId, item.seq) === childKey);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * A session's current branch, read without writing: SessionManager.open appends a newline to an
 * unterminated last line, writes a header into an empty file and rewrites older-version files,
 * while the session may still be running. Null when the file does not exist yet (Pi writes it
 * lazily), and empty when it holds no entries.
 */
async function readSessionBranch(file: string): Promise<SessionEntry[] | null> {
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
 * The real path of `sessionFile` when it lies inside the parent's child root
 * (`<dirname(parent)>/<basename(parent, .jsonl)>`, pi-subagents extension/index.js
 * `getSubagentSessionRoot`); null otherwise. A child file not written yet keeps its resolved name
 * under its real directory.
 */
async function containedChildFile(
  parentSessionFile: string,
  sessionFile: string,
): Promise<string | null> {
  if (!path.isAbsolute(sessionFile)) return null;
  const root = path.join(
    path.dirname(parentSessionFile),
    path.basename(parentSessionFile, '.jsonl'),
  );
  try {
    const realRoot = await realpath(root);
    const file = path.join(await realpath(path.dirname(sessionFile)), path.basename(sessionFile));
    const real = await realpath(file).catch((error: unknown) => {
      if (isMissing(error)) return file;
      throw error;
    });
    return real !== realRoot && inside(realRoot, real) ? real : null;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
