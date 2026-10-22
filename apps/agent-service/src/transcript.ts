import { isDeepStrictEqual } from 'node:util';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ServiceBlock } from '@atd/agent-contracts';
import type { Logger } from './logging.js';
import type { ServiceBranchItem } from './transcript-branch.js';
import { verifiedCompletionBlock } from './computer/completion-message.js';

export { fromServiceBranch, type ServiceBranchItem } from './transcript-branch.js';
import {
  collectCompleted,
  completedBlock,
  failedBlock,
  readCompactionRecord,
  runningBlock,
  type RunningCompaction,
} from './compaction/records.js';
import {
  collectBlockLookups,
  messageUsage,
  projectAssistantServiceBlocks,
  type BlockLookups,
  type PermissionLookup,
} from './transcript-blocks.js';
import type { StepList } from './transcript-details/codemode.js';
import { retryBlock, type RetryingRequest } from './transcript-retry.js';
import type { SubagentRow } from './transcript-details/subagent.js';

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== 'object' || !('type' in part)) continue;
    if (part.type === 'text' && 'text' in part && typeof part.text === 'string')
      parts.push(part.text);
  }
  return parts.join('');
}

// Joined text of ended messages' content, which live views reproject on every flush; Pi never
// edits an ended message's content array. Tools may reuse a partial result's, so those join anew.
const settledTexts = new WeakMap<object, string>();

function settledText(content: unknown): string {
  if (!Array.isArray(content)) return contentText(content);
  let text = settledTexts.get(content);
  if (text === undefined) {
    text = contentText(content);
    settledTexts.set(content, text);
  }
  return text;
}

export function toolPartialText(partialResult: unknown): string {
  if (!partialResult || typeof partialResult !== 'object' || !('content' in partialResult))
    return '';
  return contentText(partialResult.content);
}

/**
 * The calls whose results a branch holds, as the projection joins them to their blocks
 * (`collectBlockLookups`). A live transcript keeps a call's streamed state until then.
 */
export function recordedCallIds(branch: readonly ServiceBranchItem[]): string[] {
  const ids: string[] = [];
  for (const item of branch)
    if (item.type === 'message' && item.message.role === 'toolResult')
      ids.push(item.message.toolCallId);
  return ids;
}

function outputOf(result: ToolResultMessage): string {
  return settledText(result.content);
}

/** The run an `app-invocation` marker's data names; undefined for a malformed marker. */
export function invocationRunId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('runId' in data)) return undefined;
  return typeof data.runId === 'string' && data.runId ? data.runId : undefined;
}

function stampSequence(counts: Map<number, number>, timestamp: number): number {
  const next = counts.get(timestamp) ?? 0;
  counts.set(timestamp, next + 1);
  return next;
}

export interface ProjectServiceBlocksInput {
  branch: readonly ServiceBranchItem[];
  /** The assistant message streaming now, if any; live views pass their slot through. */
  partial?: AssistantMessage | undefined;
  /** When `partial` showed its first output, from the live view's `GenerationClock`. */
  firstTokenAt?: number | undefined;
  partials?: ReadonlyMap<string, string>;
  /** Latest streamed result rows of running `subagent` calls, by call id. */
  subagentProgress?: ReadonlyMap<string, readonly SubagentRow[]>;
  /** Steps of running `codemode` calls, by call id. */
  codemodeProgress?: ReadonlyMap<string, StepList>;
  /** Permission outcomes recorded outside this branch: a child's live in its parent session. */
  permissions?: ReadonlyMap<string, PermissionLookup>;
  /**
   * The task's first run, which owns what comes before the branch's first invocation marker:
   * sessions built before first runs were marked (d2a5c16) start without one.
   */
  firstRunId: string;
  live: boolean;
  /** The compaction the live session runs now; shown last until it ends. */
  compacting?: RunningCompaction | null;
  /** The failed request the live session is retrying now; shown last until it gets a response. */
  retrying?: RetryingRequest | null;
  /** Receives projection diagnostics (tool details dropped by the contract check). */
  log?: Pick<Logger, 'debug'>;
}

export function projectServiceBlocks(input: ProjectServiceBlocksInput): ServiceBlock[] {
  const branch = [...input.branch];
  if (
    input.partial &&
    !branch.some(
      (item) =>
        item.type === 'message' &&
        item.message.role === 'assistant' &&
        item.message.timestamp === input.partial?.timestamp,
    )
  )
    branch.push({ type: 'message', message: input.partial });
  const lookups: BlockLookups = collectBlockLookups(branch, input.permissions);
  const partials = input.partials ?? new Map<string, string>();
  const subagentProgress = input.subagentProgress ?? new Map<string, readonly SubagentRow[]>();
  const codemodeProgress = input.codemodeProgress ?? new Map<string, StepList>();
  const userCounts = new Map<number, number>();
  const compactionCounts = new Map<number, number>();
  const completed = collectCompleted(branch);
  let runId = input.firstRunId;
  // The first user message after a run's invocation marker is that run's prompt; the run's later
  // user messages are queued steers and follow-ups. The branch's first user message is the first
  // run's prompt even without a marker.
  let awaitingPrompt = true;
  const blocks: ServiceBlock[] = [];
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-invocation') {
        const next = invocationRunId(item.data);
        if (next) {
          runId = next;
          awaitingPrompt = true;
        }
      }
      const record = readCompactionRecord(item.customType, item.data);
      if (record?.status === 'failed') {
        const id = `cmp:failed:${record.at}:${stampSequence(compactionCounts, record.at)}`;
        blocks.push(failedBlock({ id, runId, timestamp: record.at, endedAt: record.at }, record));
      }
      continue;
    }
    if (item.type === 'compaction') {
      const base = {
        id: `cmp:${item.id}`,
        runId,
        timestamp: item.timestamp,
        endedAt: item.timestamp,
      };
      blocks.push(completedBlock(base, item, completed.get(item.id)));
      continue;
    }
    if (item.type === 'custom_message') {
      const completion = verifiedCompletionBlock(item, runId);
      if (completion) blocks.push(completion);
      continue;
    }
    if (item.superseded) continue;
    switch (item.message.role) {
      case 'toolResult':
      case 'custom':
        break;
      case 'system':
        // The leading system prompt is host configuration; mid-transcript system
        // entries are prompt/tool patches, not conversation content.
        break;
      case 'bashExecution':
      case 'branchSummary':
        break;
      case 'compactionSummary': {
        // Pi projects its compaction entries into these; a branch holds one only from older files.
        const at = item.message.timestamp;
        const id = `cmp:m:${at}:${stampSequence(compactionCounts, at)}`;
        blocks.push(
          completedBlock({ id, runId, timestamp: at, endedAt: at }, item.message, undefined),
        );
        break;
      }
      case 'user':
        blocks.push({
          kind: 'user',
          id: `u:${item.message.timestamp}:${stampSequence(userCounts, item.message.timestamp)}`,
          runId,
          timestamp: item.message.timestamp,
          endedAt: item.message.timestamp,
          text: settledText(item.message.content),
          ...(awaitingPrompt ? { prompt: true } : {}),
          ...(item.entryId ? { entryId: item.entryId } : {}),
        });
        awaitingPrompt = false;
        break;
      case 'assistant': {
        const streaming = Boolean(
          input.partial && item.message.timestamp === input.partial.timestamp,
        );
        blocks.push(
          ...projectAssistantServiceBlocks({
            message: item.message,
            runId,
            streaming,
            live: input.live,
            lookups,
            partials,
            subagentProgress,
            codemodeProgress,
            messageEndedAt: item.endedAt ?? null,
            usage: streaming
              ? undefined
              : messageUsage(item.message, lookups.generations.get(item.message.timestamp)),
            firstTokenAt: streaming ? input.firstTokenAt : undefined,
            outputOf,
            log: input.log,
          }),
        );
        break;
      }
      default: {
        const _exhaustive: never = item.message;
        return _exhaustive;
      }
    }
  }
  if (input.compacting) blocks.push(runningBlock(runId, input.compacting));
  if (input.retrying) blocks.push(retryBlock(runId, input.retrying));
  return blocks;
}

/**
 * Diffs two projections into a patch; ids are stable across live and cold paths. Blocks are plain
 * JSON data, so deep equality implies equal JSON: at worst it resends an unchanged block, never
 * drops a change. It compares without serializing, which matters because a live transcript diffs
 * its whole branch on every flush, and projections share the session's (large) output strings.
 */
export function diffServiceBlocks(
  previous: readonly ServiceBlock[],
  next: readonly ServiceBlock[],
): { blocks: ServiceBlock[]; removed: string[] } {
  const prior = new Map(previous.map((block) => [block.id, block]));
  const nextIds = new Set(next.map((block) => block.id));
  return {
    blocks: next.filter((block) => !isDeepStrictEqual(prior.get(block.id), block)),
    removed: previous.filter((block) => !nextIds.has(block.id)).map((block) => block.id),
  };
}
