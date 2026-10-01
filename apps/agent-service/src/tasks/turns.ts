import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { invocationRunId } from '../transcript.js';

/**
 * Turns on a session branch, as the turn actions address them: a turn starts at a user message
 * entry (`ServiceBlock.entryId`) and runs until the next user message or run invocation marker.
 * The run boundaries follow transcript projection (transcript.ts): the first user message after a
 * run's `app-invocation` marker is that run's prompt, and the branch's first user message is the
 * first run's prompt even without a marker.
 */

export const NOT_ON_BRANCH = "The message is not a user message on the task's current branch.";

function isUserMessage(entry: SessionEntry): boolean {
  return entry.type === 'message' && entry.message.role === 'user';
}

/** An `app-invocation` marker that projection honors (it names a run). */
function isRunMarker(entry: SessionEntry): boolean {
  return (
    entry.type === 'custom' &&
    entry.customType === 'app-invocation' &&
    invocationRunId(entry.data) !== undefined
  );
}

function userMessageAt(
  branch: readonly SessionEntry[],
  entryId: string,
): { index: number; entry: SessionEntry } {
  const index = branch.findIndex((entry) => entry.id === entryId);
  const entry = branch[index];
  if (!entry || !isUserMessage(entry)) throw new TypeError(NOT_ON_BRANCH);
  return { index, entry };
}

/**
 * The first entry that editing or regenerating user message `entryId` drops; the branch moves to
 * its parent. A run's prompt drops from the run's own invocation marker, so the run's other
 * entries before the prompt (hidden skill and material messages, a compaction Pi ran before
 * sending it) go too and the replacing run adds its own. A queued follow-up drops from itself. An
 * unmarked first prompt (sessions from before runs were marked) drops with the hidden messages
 * directly before it.
 */
export function replacedTurnStart(branch: readonly SessionEntry[], entryId: string): SessionEntry {
  const { index, entry: message } = userMessageAt(branch, entryId);
  const before = branch.slice(0, index).reverse();
  for (const entry of before) {
    if (isRunMarker(entry)) return entry;
    if (isUserMessage(entry)) return message;
  }
  let start = message;
  for (const entry of before) {
    if (entry.type !== 'custom_message') break;
    start = entry;
  }
  return start;
}

/**
 * The last entry of the turn user message `entryId` starts: the entry before the next user
 * message or run marker, else the branch leaf. Entries a later run wrote before its marker (model
 * and thinking changes, a manual compaction) stay with this turn.
 */
export function turnEnd(branch: readonly SessionEntry[], entryId: string): SessionEntry {
  const { index, entry: message } = userMessageAt(branch, entryId);
  let end = message;
  for (const entry of branch.slice(index + 1)) {
    if (isRunMarker(entry) || isUserMessage(entry)) break;
    end = entry;
  }
  return end;
}

/**
 * The runs projection attributes a branch path's entries to, in path order: each marker's run,
 * after the first run (`firstRunId`) when a message precedes the path's first marker.
 */
export function pathRunIds(path: readonly SessionEntry[], firstRunId: string): string[] {
  const ids: string[] = [];
  for (const entry of path) {
    if (entry.type === 'custom' && entry.customType === 'app-invocation') {
      const runId = invocationRunId(entry.data);
      if (runId && !ids.includes(runId)) ids.push(runId);
    } else if (entry.type === 'message' && !ids.length) ids.push(firstRunId);
  }
  return ids;
}
