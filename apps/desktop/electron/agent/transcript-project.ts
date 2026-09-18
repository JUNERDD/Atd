import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { Value } from 'typebox/value';
import {
  PermissionRecordSchema,
  QuestionRecordSchema,
  type PermissionRecord,
  type QuestionRecord,
} from './permission-schema';
import type { Block, BlockOf, ToolDetails, ToolStatus } from './transcript-schema';

type AgentMessage = AgentSession['messages'][number];

export type ProjectBranchItem =
  | { type: 'message'; message: AgentMessage }
  | { type: 'custom'; customType: string; data?: unknown }
  | {
      type: 'custom_message';
      customType: string;
      content: unknown;
      display: boolean;
    }
  | { type: 'compaction'; summary: string; timestamp: number };

export const ASK_USER_TOOL = 'ask_user';
export const ASK_USER_CANCELLED = 'The user cancelled the request.';

export interface ToolLookups {
  results: Map<string, ToolResultMessage>;
  permissions: Map<string, PermissionRecord>;
  questions: Map<string, QuestionRecord>;
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

export function invocationRunId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('runId' in data)) return undefined;
  return typeof data.runId === 'string' && data.runId ? data.runId : undefined;
}

export function stampSequence(counts: Map<number, number>, timestamp: number): number {
  const next = counts.get(timestamp) ?? 0;
  counts.set(timestamp, next + 1);
  return next;
}

export function collectLookups(branch: readonly ProjectBranchItem[]): ToolLookups {
  const results = new Map<string, ToolResultMessage>();
  const permissions = new Map<string, PermissionRecord>();
  const questions = new Map<string, QuestionRecord>();
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-permission' && Value.Check(PermissionRecordSchema, item.data))
        permissions.set(item.data.toolCallId, item.data);
      if (item.customType === 'app-question' && Value.Check(QuestionRecordSchema, item.data))
        questions.set(item.data.toolCallId, item.data);
      continue;
    }
    if (item.type !== 'message' || item.message.role !== 'toolResult') continue;
    results.set(item.message.toolCallId, item.message);
  }
  return { results, permissions, questions };
}

export function mapStopReason(
  reason: AssistantMessage['stopReason'],
  streaming: boolean,
): BlockOf<'assistant'>['stopReason'] {
  if (streaming) return null;
  switch (reason) {
    case 'stop':
    case 'length':
    case 'error':
    case 'aborted':
      return reason;
    case 'toolUse':
    case 'pending':
    case 'deferred':
      return 'stop';
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

export function normalizeDetails(details: unknown): ToolDetails {
  const record = details && typeof details === 'object' ? (details as Record<string, unknown>) : {};
  const truncation =
    record.truncation && typeof record.truncation === 'object'
      ? (record.truncation as { truncated?: unknown })
      : undefined;
  return {
    diff: typeof record.diff === 'string' ? record.diff : '',
    truncated: truncation?.truncated === true,
    fullOutputPath: typeof record.fullOutputPath === 'string' ? record.fullOutputPath : '',
  };
}

export function resolveToolStatus(input: {
  result: ToolResultMessage | undefined;
  declined: boolean;
  live: boolean;
}): ToolStatus {
  if (input.declined) return 'declined';
  if (input.result) return input.result.isError ? 'failed' : 'completed';
  return input.live ? 'running' : 'interrupted';
}

function argumentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function stringOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((option): option is string => typeof option === 'string');
}

export function projectAssistantBlocks(input: {
  message: AssistantMessage;
  runId: string;
  streaming: boolean;
  live: boolean;
  lookups: ToolLookups;
  partials: ReadonlyMap<string, string>;
}): Block[] {
  const { message, runId, streaming, live, lookups, partials } = input;
  const timestamp = message.timestamp;
  const error = message.errorMessage ?? '';
  const stopReason = mapStopReason(message.stopReason, streaming);
  const blocks: Block[] = [];
  message.content.forEach((part, index) => {
    switch (part.type) {
      case 'text':
        blocks.push({
          kind: 'assistant',
          id: `a:${timestamp}:${index}`,
          runId,
          timestamp,
          text: part.text,
          streaming,
          stopReason,
          error,
        });
        return;
      case 'thinking':
        blocks.push({
          kind: 'thinking',
          id: `t:${timestamp}:${index}`,
          runId,
          timestamp,
          text: part.thinking,
          streaming,
          redacted: Boolean(part.redacted),
        });
        return;
      case 'toolCall': {
        const args = argumentRecord(part.arguments);
        if (part.name === ASK_USER_TOOL) {
          const record = lookups.questions.get(part.id);
          const result = lookups.results.get(part.id);
          blocks.push({
            kind: 'question',
            id: `q:${part.id}`,
            runId,
            timestamp,
            callId: part.id,
            title: typeof args.question === 'string' ? args.question : '',
            options: stringOptions(args.options),
            status: resolveToolStatus({ result, declined: false, live }),
            answer: record ? record.answer : null,
            skipped: record ? record.answer === null : false,
          });
          return;
        }
        const result = lookups.results.get(part.id);
        const permission = lookups.permissions.get(part.id);
        blocks.push({
          kind: 'tool',
          id: `tool:${part.id}`,
          runId,
          timestamp,
          callId: part.id,
          name: part.name,
          args,
          status: resolveToolStatus({
            result,
            declined: permission?.outcome === 'declined',
            live,
          }),
          output: result ? contentText(result.content) : '',
          partial: result ? '' : (partials.get(part.id) ?? ''),
          details: normalizeDetails(result?.details),
          permission: permission ? { scope: permission.scope, outcome: permission.outcome } : null,
        });
        return;
      }
      default: {
        const _exhaustive: never = part;
        return _exhaustive;
      }
    }
  });
  return blocks;
}
