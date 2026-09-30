import { isDeepStrictEqual } from 'node:util';
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ServiceBlock } from '@ai/agent-contracts';
import type { Logger } from './logging.js';
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
  projectAssistantServiceBlocks,
  type BlockLookups,
  type PermissionLookup,
} from './transcript-blocks.js';
import type { SubagentRow } from './transcript-details/subagent.js';

type AgentMessage = AgentSession['messages'][number];

export type ServiceBranchItem =
  | {
      type: 'message';
      message: AgentMessage;
      endedAt?: number;
      /** A failed attempt an overflow compaction replaced with its retry (`supersededEntries`). */
      superseded?: true;
    }
  | { type: 'custom'; customType: string; data?: unknown }
  | { type: 'custom_message'; customType: string; content: unknown; display: boolean }
  | { type: 'compaction'; id: string; summary: string; tokensBefore: number; timestamp: number };

/**
 * Pi 0.99 session-branch projection. `usage` entries are reported on the
 * settled message instead, and mid-transcript `system` entries are prompt
 * patches rather than conversation content, so both are skipped by design.
 * `context_edit` entries only change what later provider requests see; the
 * transcript keeps showing the raw history they edit, so they are skipped too,
 * except that they mark attempts an overflow compaction superseded.
 */
export function fromServiceBranch(entries: readonly SessionEntry[]): ServiceBranchItem[] {
  const items: ServiceBranchItem[] = [];
  const superseded = supersededEntries(entries);
  for (const entry of entries) {
    switch (entry.type) {
      case 'message': {
        const endedAt = Date.parse(entry.timestamp);
        items.push({
          type: 'message',
          message: entry.message,
          ...(Number.isNaN(endedAt) ? {} : { endedAt }),
          ...(superseded.has(entry.id) ? { superseded: true as const } : {}),
        });
        break;
      }
      case 'custom':
        items.push({ type: 'custom', customType: entry.customType, data: entry.data });
        break;
      case 'custom_message':
        items.push({
          type: 'custom_message',
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
        });
        break;
      case 'compaction':
        items.push({
          type: 'compaction',
          id: entry.id,
          summary: entry.summary,
          tokensBefore: entry.tokensBefore,
          timestamp: Date.parse(entry.timestamp) || 0,
        });
        break;
      case 'thinking_level_change':
      case 'model_change':
      case 'branch_summary':
      case 'label':
      case 'session_info':
      case 'usage':
      case 'context_edit':
        break;
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }
  return items;
}

/**
 * Messages Pi dropped to retry after an overflow. Before compacting and retrying a turn that
 * overflowed the context, Pi omits the failed attempt from later context with a `context_edit`
 * whose replacement is null (`AgentSession._omitRecoveryAttempt`); the service's own edits always
 * replace content. Once a compaction follows the omission, the retry supersedes the attempt, so
 * its error is not the run's outcome and must not show. Without that compaction (the recovery
 * failed) the attempt keeps showing.
 */
function supersededEntries(entries: readonly SessionEntry[]): Set<string> {
  const omitted = new Set<string>();
  const superseded = new Set<string>();
  for (const entry of entries) {
    if (entry.type === 'context_edit' && entry.replacement === null) omitted.add(entry.targetId);
    if (entry.type !== 'compaction') continue;
    for (const id of omitted) superseded.add(id);
    omitted.clear();
  }
  return superseded;
}

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

export function toolPartialText(partialResult: unknown): string {
  if (!partialResult || typeof partialResult !== 'object' || !('content' in partialResult))
    return '';
  return contentText(partialResult.content);
}

function outputOf(result: ToolResultMessage): string {
  return contentText(result.content);
}

function invocationRunId(data: unknown): string | undefined {
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
  partial?: AssistantMessage;
  partials?: ReadonlyMap<string, string>;
  /** Latest streamed result rows of running `subagent` calls, by call id. */
  subagentProgress?: ReadonlyMap<string, readonly SubagentRow[]>;
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
    if (item.type === 'custom_message' || item.superseded) continue;
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
          text: contentText(item.message.content),
          ...(awaitingPrompt ? { prompt: true } : {}),
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
            messageEndedAt: item.endedAt ?? null,
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
