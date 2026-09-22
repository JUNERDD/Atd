import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  GrantScopeSchema,
  type GrantScope,
  type ServiceBlock,
  type ServiceToolStatus,
} from '@ai/agent-contracts';
import type { ServiceBranchItem } from './transcript.js';

const PermissionRecordSchema = Type.Object(
  {
    toolCallId: Type.String(),
    runId: Type.String(),
    scope: GrantScopeSchema,
    outcome: Type.Union([
      Type.Literal('once'),
      Type.Literal('session'),
      Type.Literal('grant'),
      Type.Literal('tier'),
      Type.Literal('declined'),
    ]),
    at: Type.Number(),
  },
  { additionalProperties: false },
);

const QuestionRecordSchema = Type.Object(
  {
    toolCallId: Type.String(),
    runId: Type.String(),
    answer: Type.Union([Type.String(), Type.Null()]),
    at: Type.Number(),
  },
  { additionalProperties: false },
);

export const ASK_USER_TOOL = 'ask_user';

export interface BlockLookups {
  results: Map<string, ToolResultMessage>;
  resultEnds: Map<string, number>;
  permissions: Map<
    string,
    { scope: GrantScope; outcome: 'once' | 'session' | 'grant' | 'tier' | 'declined' }
  >;
  questions: Map<string, string | null>;
}

/** Collects tool results and app records so blocks can join them by call id. */
export function collectBlockLookups(branch: readonly ServiceBranchItem[]): BlockLookups {
  const results = new Map<string, ToolResultMessage>();
  const resultEnds = new Map<string, number>();
  const permissions: BlockLookups['permissions'] = new Map();
  const questions = new Map<string, string | null>();
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-permission' && Value.Check(PermissionRecordSchema, item.data))
        permissions.set(item.data.toolCallId, {
          scope: item.data.scope,
          outcome: item.data.outcome,
        });
      if (item.customType === 'app-question' && Value.Check(QuestionRecordSchema, item.data))
        questions.set(item.data.toolCallId, item.data.answer);
      continue;
    }
    if (item.type !== 'message' || item.message.role !== 'toolResult') continue;
    results.set(item.message.toolCallId, item.message);
    if (item.endedAt !== undefined) resultEnds.set(item.message.toolCallId, item.endedAt);
  }
  return { results, resultEnds, permissions, questions };
}

function resolveStatus(
  result: ToolResultMessage | undefined,
  declined: boolean,
  live: boolean,
): ServiceToolStatus {
  if (declined) return 'declined';
  if (result) return result.isError ? 'failed' : 'completed';
  return live ? 'running' : 'interrupted';
}

function argumentRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

function stringOptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((option): option is string => typeof option === 'string');
}

function mapStopReason(
  reason: AssistantMessage['stopReason'],
  streaming: boolean,
): 'stop' | 'length' | 'error' | 'aborted' | null {
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

export interface AssistantBlockInput {
  message: AssistantMessage;
  runId: string;
  streaming: boolean;
  live: boolean;
  lookups: BlockLookups;
  partials: ReadonlyMap<string, string>;
  /** Session entry time of this message (its end); null for live partials. */
  messageEndedAt: number | null;
  outputOf: (result: ToolResultMessage) => string;
}

/** Projects one assistant message into text/thinking/tool/question blocks. */
export function projectAssistantServiceBlocks(input: AssistantBlockInput): ServiceBlock[] {
  const { message, runId, streaming, live, lookups, partials, messageEndedAt, outputOf } = input;
  const timestamp = message.timestamp;
  const endedAt = messageEndedAt ?? timestamp;
  const blocks: ServiceBlock[] = [];
  message.content.forEach((part, index) => {
    switch (part.type) {
      case 'text':
        blocks.push({
          kind: 'assistant',
          id: `a:${timestamp}:${index}`,
          runId,
          timestamp,
          endedAt,
          text: part.text,
          streaming,
          stopReason: mapStopReason(message.stopReason, streaming),
          error: message.errorMessage ?? '',
        });
        return;
      case 'thinking':
        blocks.push({
          kind: 'thinking',
          id: `t:${timestamp}:${index}`,
          runId,
          timestamp,
          endedAt,
          text: part.thinking,
          streaming,
          redacted: Boolean(part.redacted),
        });
        return;
      case 'toolCall': {
        const args = argumentRecord(part.arguments);
        const result = lookups.results.get(part.id);
        if (part.name === ASK_USER_TOOL) {
          const answer = lookups.questions.get(part.id) ?? null;
          const answered = lookups.questions.has(part.id);
          blocks.push({
            kind: 'question',
            id: `q:${part.id}`,
            runId,
            timestamp,
            endedAt: lookups.resultEnds.get(part.id) ?? endedAt,
            callId: part.id,
            title: typeof args.question === 'string' ? args.question : '',
            options: stringOptions(args.options),
            status: resolveStatus(result, false, live),
            answer,
            skipped: answered && answer === null,
          });
          return;
        }
        const permission = lookups.permissions.get(part.id);
        blocks.push({
          kind: 'tool',
          id: `tool:${part.id}`,
          runId,
          timestamp,
          endedAt: lookups.resultEnds.get(part.id) ?? endedAt,
          callId: part.id,
          name: part.name,
          args,
          status: resolveStatus(result, permission?.outcome === 'declined', live),
          output: result ? outputOf(result) : '',
          partial: result ? '' : (partials.get(part.id) ?? ''),
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
