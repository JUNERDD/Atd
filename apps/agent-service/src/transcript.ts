import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import type { ServiceBlock } from '@ai/agent-contracts';
import type { Logger } from './logging.js';
import {
  collectBlockLookups,
  projectAssistantServiceBlocks,
  type BlockLookups,
} from './transcript-blocks.js';

type AgentMessage = AgentSession['messages'][number];

export type ServiceBranchItem =
  | { type: 'message'; message: AgentMessage; endedAt?: number }
  | { type: 'custom'; customType: string; data?: unknown }
  | { type: 'custom_message'; customType: string; content: unknown; display: boolean }
  | { type: 'compaction'; summary: string; timestamp: number };

/**
 * Pi 0.86 session-branch projection. `usage` entries are reported on the
 * settled message instead, and mid-transcript `system` entries are prompt
 * patches rather than conversation content, so both are skipped by design.
 */
export function fromServiceBranch(entries: readonly SessionEntry[]): ServiceBranchItem[] {
  const items: ServiceBranchItem[] = [];
  for (const entry of entries) {
    switch (entry.type) {
      case 'message': {
        const endedAt = Date.parse(entry.timestamp);
        items.push({
          type: 'message',
          message: entry.message,
          ...(Number.isNaN(endedAt) ? {} : { endedAt }),
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
          summary: entry.summary,
          timestamp: Date.parse(entry.timestamp) || 0,
        });
        break;
      case 'thinking_level_change':
      case 'model_change':
      case 'branch_summary':
      case 'label':
      case 'session_info':
      case 'usage':
        break;
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }
  return items;
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

function systemBlock(
  runId: string,
  timestamp: number,
  text: string,
  counts: Map<number, number>,
): ServiceBlock {
  return {
    kind: 'system',
    id: `s:${timestamp}:${stampSequence(counts, timestamp)}`,
    runId,
    timestamp,
    endedAt: timestamp,
    level: 'info',
    text,
  };
}

export interface ProjectServiceBlocksInput {
  branch: readonly ServiceBranchItem[];
  partial?: AssistantMessage;
  partials?: ReadonlyMap<string, string>;
  /**
   * The task's first run, which owns what comes before the branch's first invocation marker:
   * sessions built before first runs were marked (d2a5c16) start without one.
   */
  firstRunId: string;
  live: boolean;
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
  const lookups: BlockLookups = collectBlockLookups(branch);
  const partials = input.partials ?? new Map<string, string>();
  const userCounts = new Map<number, number>();
  const systemCounts = new Map<number, number>();
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
      continue;
    }
    if (item.type === 'compaction') {
      blocks.push(systemBlock(runId, item.timestamp, item.summary, systemCounts));
      continue;
    }
    if (item.type === 'custom_message') continue;
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
      case 'compactionSummary':
        blocks.push(systemBlock(runId, item.message.timestamp, item.message.summary, systemCounts));
        break;
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
  return blocks;
}

/** Diffs two projections into a patch; ids are stable across live and cold paths. */
export function diffServiceBlocks(
  previous: readonly ServiceBlock[],
  next: readonly ServiceBlock[],
): { blocks: ServiceBlock[]; removed: string[] } {
  const prior = new Map(previous.map((block) => [block.id, block]));
  const nextIds = new Set(next.map((block) => block.id));
  return {
    blocks: next.filter((block) => JSON.stringify(prior.get(block.id)) !== JSON.stringify(block)),
    removed: previous.filter((block) => !nextIds.has(block.id)).map((block) => block.id),
  };
}
