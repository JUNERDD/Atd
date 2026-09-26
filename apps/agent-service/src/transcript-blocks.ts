import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  GrantScopeSchema,
  PermissionOutcomeSchema,
  SUBAGENT_CHILD_ENTRY,
  SubagentChildEntrySchema,
  type GrantScope,
  type PermissionOutcome,
  type ServiceBlock,
  type ServiceToolStatus,
  type SubagentChildEntry,
  type ToolBlockDetails,
} from '@ai/agent-contracts';
import type { Logger } from './logging.js';
import { isSubagentLaunch, SUBAGENT_TOOL } from './subagents/tool-contract.js';
import { projectSubagentToolDetails, projectToolDetails } from './transcript-details/index.js';
import { subagentRows, type SubagentRow } from './transcript-details/subagent.js';
import type { ServiceBranchItem } from './transcript.js';

const PermissionRecordSchema = Type.Object(
  {
    toolCallId: Type.String(),
    runId: Type.String(),
    scope: GrantScopeSchema,
    outcome: PermissionOutcomeSchema,
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

export interface PermissionLookup {
  scope: GrantScope;
  outcome: PermissionOutcome;
}

/** Recorded permission outcomes (`app-permission`) by tool call id. */
export type PermissionLookups = Map<string, PermissionLookup>;

export interface BlockLookups {
  results: Map<string, ToolResultMessage>;
  resultEnds: Map<string, number>;
  permissions: PermissionLookups;
  questions: Map<string, string | null>;
  /** `app-child` entries by the launching `subagent` call id, in `seq` order. */
  children: Map<string, SubagentChildEntry[]>;
}

/** The permission outcomes a session branch recorded. */
export function collectPermissionLookups(branch: readonly ServiceBranchItem[]): PermissionLookups {
  const permissions: PermissionLookups = new Map();
  for (const item of branch) {
    if (
      item.type === 'custom' &&
      item.customType === 'app-permission' &&
      Value.Check(PermissionRecordSchema, item.data)
    )
      permissions.set(item.data.toolCallId, { scope: item.data.scope, outcome: item.data.outcome });
  }
  return permissions;
}

/**
 * Collects tool results and app records so blocks can join them by call id. `permissions` adds
 * outcomes recorded in another session: a child's approvals land in its parent's session.
 */
export function collectBlockLookups(
  branch: readonly ServiceBranchItem[],
  permissions?: ReadonlyMap<string, PermissionLookup>,
): BlockLookups {
  const results = new Map<string, ToolResultMessage>();
  const resultEnds = new Map<string, number>();
  const own = collectPermissionLookups(branch);
  const merged: PermissionLookups = new Map([...(permissions ?? []), ...own]);
  const questions = new Map<string, string | null>();
  const children = new Map<string, SubagentChildEntry[]>();
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-question' && Value.Check(QuestionRecordSchema, item.data))
        questions.set(item.data.toolCallId, item.data.answer);
      if (
        item.customType === SUBAGENT_CHILD_ENTRY &&
        Value.Check(SubagentChildEntrySchema, item.data)
      )
        children.set(item.data.toolCallId, [
          ...(children.get(item.data.toolCallId) ?? []),
          item.data,
        ]);
      continue;
    }
    if (item.type !== 'message' || item.message.role !== 'toolResult') continue;
    results.set(item.message.toolCallId, item.message);
    if (item.endedAt !== undefined) resultEnds.set(item.message.toolCallId, item.endedAt);
  }
  for (const entries of children.values()) entries.sort((a, b) => a.seq - b.seq);
  return { results, resultEnds, permissions: merged, questions, children };
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
  /** The whole message is still the live partial; per-part liveness derives from it. */
  streaming: boolean;
  live: boolean;
  lookups: BlockLookups;
  partials: ReadonlyMap<string, string>;
  /** Latest streamed result rows of running `subagent` calls (live-transcript.ts). */
  subagentProgress: ReadonlyMap<string, readonly SubagentRow[]>;
  /** Session entry time of this message (its end); null for live partials. */
  messageEndedAt: number | null;
  outputOf: (result: ToolResultMessage) => string;
  /** Receives diagnostics for tool details dropped by the projection. */
  log?: Pick<Logger, 'debug'>;
}

/**
 * Raw result details stop here: a tool gets the whitelisted projection once completed, except a
 * launching `subagent` call, whose child cards exist in every status.
 */
function toolDetails(
  input: AssistantBlockInput,
  call: {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: ServiceToolStatus;
    result: ToolResultMessage | undefined;
  },
): ToolBlockDetails | undefined {
  const { id, name, args, status, result } = call;
  if (name === SUBAGENT_TOOL && isSubagentLaunch(args))
    return projectSubagentToolDetails(
      {
        args,
        status,
        children: input.lookups.children.get(id) ?? [],
        rows: result ? subagentRows(result.details) : (input.subagentProgress.get(id) ?? []),
      },
      input.log,
    );
  return result && status === 'completed'
    ? projectToolDetails(name, result.details, input.log)
    : undefined;
}

/** Projects one assistant message into text/thinking/tool/question blocks. */
export function projectAssistantServiceBlocks(input: AssistantBlockInput): ServiceBlock[] {
  const { message, runId, streaming, live, lookups, partials, messageEndedAt, outputOf } = input;
  const timestamp = message.timestamp;
  const endedAt = messageEndedAt ?? timestamp;
  const blocks: ServiceBlock[] = [];
  const stopReason = mapStopReason(message.stopReason, streaming);
  message.content.forEach((part, index) => {
    // A provider streams content parts in order, so only the newest part of the live partial is
    // still growing: a thought is finished once the answer after it starts. The stop reason
    // stays message-level because it is only known when the whole message ends.
    const partStreaming = streaming && index === message.content.length - 1;
    switch (part.type) {
      case 'text':
        blocks.push({
          kind: 'assistant',
          id: `a:${timestamp}:${index}`,
          runId,
          timestamp,
          endedAt,
          text: part.text,
          streaming: partStreaming,
          stopReason,
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
          streaming: partStreaming,
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
        const status = resolveStatus(result, permission?.outcome === 'declined', live);
        const details = toolDetails(input, { id: part.id, name: part.name, args, status, result });
        blocks.push({
          kind: 'tool',
          id: `tool:${part.id}`,
          runId,
          timestamp,
          endedAt: lookups.resultEnds.get(part.id) ?? endedAt,
          callId: part.id,
          name: part.name,
          args,
          status,
          output: result ? outputOf(result) : '',
          partial: result ? '' : (partials.get(part.id) ?? ''),
          permission: permission ? { scope: permission.scope, outcome: permission.outcome } : null,
          ...(details ? { details } : {}),
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
