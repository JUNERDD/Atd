import type { AssistantMessage, ToolResultMessage } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import { Compile } from 'typebox/compile';
import {
  GrantScopeSchema,
  PermissionOutcomeSchema,
  SUBAGENT_CHILD_ENTRY,
  SubagentChildEntrySchema,
  type GrantScope,
  type MessageUsage,
  type PermissionOutcome,
  type ServiceBlock,
  type ServiceToolStatus,
  type SubagentAgentEntry,
  type SubagentChildEntry,
} from '@atd/agent-contracts';
import { readGenerationRecord, readThinkingRecord, thinkingBlockId } from './generation.js';
import type { Logger } from './logging.js';
import type { StepList } from './transcript-details/codemode.js';
import { projectBlockDetails } from './transcript-details/index.js';
import type { SubagentRow } from './transcript-details/subagent.js';
import { agentEntryOf } from './transcript-details/subagent-define.js';
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

/**
 * The part of pi-ai's `Usage` a block reports. A stored message is untrusted: files written by
 * older Pi builds or failed requests may lack counts, and then the blocks carry no usage.
 */
const StoredUsageSchema = Type.Object({
  input: Type.Integer({ minimum: 0 }),
  output: Type.Integer({ minimum: 0 }),
  cacheRead: Type.Integer({ minimum: 0 }),
  cacheWrite: Type.Integer({ minimum: 0 }),
  cost: Type.Object({ total: Type.Number({ minimum: 0 }) }),
});

// Compiled once: every live reprojection checks each record on the branch.
const PermissionRecordValidator = Compile(PermissionRecordSchema);
const QuestionRecordValidator = Compile(QuestionRecordSchema);
const SubagentChildEntryValidator = Compile(SubagentChildEntrySchema);
const StoredUsageValidator = Compile(StoredUsageSchema);

/**
 * A settled assistant message's usage as blocks report it, with the generation time the service
 * measured for it (`durationMs`, generation.ts) when there is one; undefined without valid counts.
 */
export function messageUsage(
  message: AssistantMessage,
  durationMs: number | undefined,
): MessageUsage | undefined {
  const usage: unknown = message.usage;
  if (!StoredUsageValidator.Check(usage)) return undefined;
  const { input, output, cacheRead, cacheWrite, cost } = usage;
  const timed = durationMs === undefined ? {} : { durationMs };
  return { input, output, cacheRead, cacheWrite, cost: cost.total, ...timed };
}

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
  /** `app-agent` entries by the defining `subagent` call id, in entry order. */
  agents: Map<string, SubagentAgentEntry[]>;
  /** Measured generation time (`app-generation` entries) by assistant message `timestamp`. */
  generations: Map<number, number>;
  /** Measured reasoning time (`app-thinking` entries) by thinking block id. */
  thoughts: Map<string, number>;
}

/** The permission outcomes a session branch recorded. */
export function collectPermissionLookups(branch: readonly ServiceBranchItem[]): PermissionLookups {
  const permissions: PermissionLookups = new Map();
  for (const item of branch) {
    if (
      item.type === 'custom' &&
      item.customType === 'app-permission' &&
      PermissionRecordValidator.Check(item.data)
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
  const agents = new Map<string, SubagentAgentEntry[]>();
  const generations = new Map<number, number>();
  const thoughts = new Map<string, number>();
  for (const item of branch) {
    if (item.type === 'custom') {
      if (item.customType === 'app-question' && QuestionRecordValidator.Check(item.data))
        questions.set(item.data.toolCallId, item.data.answer);
      const generation = readGenerationRecord(item.customType, item.data);
      if (generation) generations.set(generation.timestamp, generation.durationMs);
      const thought = readThinkingRecord(item.customType, item.data);
      if (thought) thoughts.set(thought.blockId, thought.durationMs);
      if (item.customType === SUBAGENT_CHILD_ENTRY && SubagentChildEntryValidator.Check(item.data))
        children.set(item.data.toolCallId, [
          ...(children.get(item.data.toolCallId) ?? []),
          item.data,
        ]);
      const agent = agentEntryOf(item.customType, item.data);
      if (agent) agents.set(agent.toolCallId, [...(agents.get(agent.toolCallId) ?? []), agent]);
      continue;
    }
    if (item.type !== 'message' || item.message.role !== 'toolResult') continue;
    results.set(item.message.toolCallId, item.message);
    if (item.endedAt !== undefined) resultEnds.set(item.message.toolCallId, item.endedAt);
  }
  for (const entries of children.values()) entries.sort((a, b) => a.seq - b.seq);
  return {
    results,
    resultEnds,
    permissions: merged,
    questions,
    children,
    agents,
    generations,
    thoughts,
  };
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
  /** Steps of running `codemode` calls by call id (live-transcript.ts). */
  codemodeProgress: ReadonlyMap<string, StepList>;
  /** Session entry time of this message (its end); null for live partials. */
  messageEndedAt: number | null;
  /**
   * The message's usage (`messageUsage`), copied onto every block it yields; undefined while it
   * streams, since a partial's counts are not final.
   */
  usage: MessageUsage | undefined;
  /** While it streams, when its first output arrived (generation.ts); copied like `usage`. */
  firstTokenAt: number | undefined;
  outputOf: (result: ToolResultMessage) => string;
  /** Receives diagnostics for tool details dropped by the projection; passed through from the caller. */
  log?: Pick<Logger, 'debug'> | undefined;
}

/** Projects one assistant message into text/thinking/tool/question blocks. */
export function projectAssistantServiceBlocks(input: AssistantBlockInput): ServiceBlock[] {
  const { message, runId, streaming, live, lookups, partials, messageEndedAt, outputOf } = input;
  const timestamp = message.timestamp;
  const endedAt = messageEndedAt ?? timestamp;
  const shared = {
    ...(input.usage ? { usage: input.usage } : {}),
    ...(input.firstTokenAt === undefined ? {} : { firstTokenAt: input.firstTokenAt }),
  };
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
          ...shared,
        });
        return;
      case 'thinking': {
        const id = thinkingBlockId(timestamp, index);
        const durationMs = lookups.thoughts.get(id);
        blocks.push({
          kind: 'thinking',
          id,
          runId,
          timestamp,
          endedAt,
          text: part.thinking,
          streaming: partStreaming,
          redacted: Boolean(part.redacted),
          ...(durationMs === undefined ? {} : { durationMs }),
          ...shared,
        });
        return;
      }
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
            ...shared,
          });
          return;
        }
        const permission = lookups.permissions.get(part.id);
        const status = resolveStatus(result, permission?.outcome === 'declined', live);
        const call = { id: part.id, name: part.name, args, status, result };
        const details = projectBlockDetails(call, input);
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
          ...shared,
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
