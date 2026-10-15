import { stat } from 'node:fs/promises';
import { errorMessage, type AgentTask, type ServiceBlock } from '@atd/agent-contracts';
import type { LiveState } from '../live-state.js';
import type { Logger } from '../logging.js';
import { isMissing, readSessionBranch } from '../session-branch-read.js';
import { fromServiceBranch, projectServiceBlocks } from '../transcript.js';

/** One thing the user or the assistant said, NFC-normalized for matching. */
export interface SearchMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * What history search reads of a transcript: user messages and assistant text blocks, in order.
 * Thinking, tool calls and results, compactions, retries and system notes are not conversation,
 * and the projection never emits custom or hidden messages.
 */
export function conversationMessages(blocks: readonly ServiceBlock[]): SearchMessage[] {
  const messages: SearchMessage[] = [];
  for (const block of blocks) {
    if (block.kind !== 'user' && block.kind !== 'assistant') continue;
    const text = block.text.normalize('NFC');
    if (text.trim()) messages.push({ role: block.kind, text });
  }
  return messages;
}

interface CachedText {
  /** The session file's path, size and mtime the messages were read at. */
  key: string;
  messages: SearchMessage[];
}

/**
 * The conversation text of each task, for history search. A task with a live session reads its
 * in-memory transcript, which is current and changes too often to cache. Any other task reads
 * the raw branch of its session file (session-branch-read.ts), projected the way the transcript
 * shows it, so messages compacted out of the model context still match; that text is cached in
 * memory per task until the file's path, size or mtime changes. Nothing is persisted, and
 * subagent child sessions, which live in files of their own, are never read.
 */
export class TaskSearchText {
  private readonly cache = new Map<string, CachedText>();
  /** Reads in flight by task: concurrent searches (one per keystroke) share one read of a file. */
  private readonly reading = new Map<string, { key: string; messages: Promise<SearchMessage[]> }>();

  constructor(private readonly log: Pick<Logger, 'warn'>) {}

  async messages(task: AgentTask, live: LiveState | null): Promise<SearchMessage[]> {
    if (live) return conversationMessages(live.transcript.snapshot().blocks);
    const [first] = task.runs;
    if (!task.sessionFile || !first) return [];
    const key = await fileKey(task.sessionFile).catch((error: unknown) => {
      this.warn(task, error);
      return null;
    });
    if (key === null) {
      this.cache.delete(task.id);
      return [];
    }
    const cached = this.cache.get(task.id);
    if (cached?.key === key) return cached.messages;
    const reading = this.reading.get(task.id);
    if (reading?.key === key) return reading.messages;
    const messages = this.read(task, task.sessionFile, first.id)
      .then((read) => {
        // A file unreadable as a session caches empty too, so it is not reparsed on every search.
        this.cache.set(task.id, { key, messages: read });
        return read;
      })
      .finally(() => {
        if (this.reading.get(task.id)?.messages === messages) this.reading.delete(task.id);
      });
    this.reading.set(task.id, { key, messages });
    return messages;
  }

  /** Forgets the text of tasks no longer in the ledger. */
  retain(taskIds: ReadonlySet<string>): void {
    for (const taskId of this.cache.keys()) if (!taskIds.has(taskId)) this.cache.delete(taskId);
  }

  private async read(
    task: AgentTask,
    sessionFile: string,
    firstRunId: string,
  ): Promise<SearchMessage[]> {
    try {
      const entries = await readSessionBranch(sessionFile);
      if (!entries) return [];
      const branch = fromServiceBranch(entries);
      return conversationMessages(projectServiceBlocks({ branch, firstRunId, live: false }));
    } catch (error) {
      this.warn(task, error);
      return [];
    }
  }

  /** A session that cannot be read leaves its task out of the results, never fails the search. */
  private warn(task: AgentTask, error: unknown): void {
    this.log.warn('A session could not be read for search.', {
      taskId: task.id,
      error: errorMessage(error),
    });
  }
}

/** The cache key of a session file; null when it does not exist yet. */
async function fileKey(file: string): Promise<string | null> {
  try {
    const info = await stat(file);
    return `${file}\0${info.size}\0${info.mtimeMs}`;
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
