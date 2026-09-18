import { Value } from 'typebox/value';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { grantKey, PermissionRecordSchema, type GrantScope } from './permission-schema';
import type { Block } from './transcript-schema';
import {
  collectLookups,
  contentText,
  invocationRunId,
  projectAssistantBlocks,
  stampSequence,
  type ProjectBranchItem,
} from './transcript-project';

export type { ProjectBranchItem } from './transcript-project';

export interface ProjectBlocksInput {
  branch: readonly ProjectBranchItem[];
  partial?: AssistantMessage;
  partials?: ReadonlyMap<string, string>;
  defaultRunId: string;
  live: boolean;
}

export function fromSessionBranch(entries: readonly SessionEntry[]): ProjectBranchItem[] {
  const items: ProjectBranchItem[] = [];
  for (const entry of entries) {
    switch (entry.type) {
      case 'message':
        items.push({ type: 'message', message: entry.message });
        break;
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
        break;
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }
  return items;
}

export function firstInvocationRunId(branch: readonly ProjectBranchItem[]): string | undefined {
  for (const item of branch) {
    if (item.type !== 'custom' || item.customType !== 'app-invocation') continue;
    const runId = invocationRunId(item.data);
    if (runId) return runId;
  }
}

export function sessionGrants(branch: readonly ProjectBranchItem[]): GrantScope[] {
  const seen = new Set<string>();
  const grants: GrantScope[] = [];
  for (const item of branch) {
    if (item.type !== 'custom' || item.customType !== 'app-permission') continue;
    if (!Value.Check(PermissionRecordSchema, item.data) || item.data.outcome !== 'session')
      continue;
    const key = grantKey(item.data.scope);
    if (seen.has(key)) continue;
    seen.add(key);
    grants.push(item.data.scope);
  }
  return grants;
}

function hasAssistant(branch: readonly ProjectBranchItem[], message: AssistantMessage): boolean {
  return branch.some(
    (item) =>
      item.type === 'message' &&
      item.message.role === 'assistant' &&
      item.message.timestamp === message.timestamp,
  );
}

function systemBlock(
  runId: string,
  timestamp: number,
  text: string,
  counts: Map<number, number>,
): Block {
  return {
    kind: 'system',
    id: `s:${timestamp}:${stampSequence(counts, timestamp)}`,
    runId,
    timestamp,
    level: 'info',
    text,
  };
}

export function projectBlocks(input: ProjectBlocksInput): Block[] {
  const branch = [...input.branch];
  if (input.partial && !hasAssistant(branch, input.partial))
    branch.push({ type: 'message', message: input.partial });
  const lookups = collectLookups(branch);
  const partials = input.partials ?? new Map<string, string>();
  const userCounts = new Map<number, number>();
  const systemCounts = new Map<number, number>();
  let runId = input.defaultRunId;
  const blocks: Block[] = [];
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-invocation') {
        const next = invocationRunId(item.data);
        if (next) runId = next;
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
        break;
      case 'custom':
        break;
      case 'bashExecution':
      case 'branchSummary':
        break;
      case 'compactionSummary':
        blocks.push(systemBlock(runId, item.message.timestamp, item.message.summary, systemCounts));
        break;
      case 'user': {
        const timestamp = item.message.timestamp;
        blocks.push({
          kind: 'user',
          id: `u:${timestamp}:${stampSequence(userCounts, timestamp)}`,
          runId,
          timestamp,
          text: contentText(item.message.content),
        });
        break;
      }
      case 'assistant': {
        const streaming = Boolean(
          input.partial && item.message.timestamp === input.partial.timestamp,
        );
        blocks.push(
          ...projectAssistantBlocks({
            message: item.message,
            runId,
            streaming,
            live: input.live,
            lookups,
            partials,
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

export function diffBlocks(
  previous: readonly Block[],
  next: readonly Block[],
): { blocks: Block[]; removed: string[] } {
  const prior = new Map(previous.map((block) => [block.id, block]));
  const nextIds = new Set(next.map((block) => block.id));
  return {
    blocks: next.filter((block) => JSON.stringify(prior.get(block.id)) !== JSON.stringify(block)),
    removed: previous.filter((block) => !nextIds.has(block.id)).map((block) => block.id),
  };
}

export { contentText } from './transcript-project';
