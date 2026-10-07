import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';
import { Compile } from 'typebox/compile';

/**
 * Generation timing of assistant messages, which Pi does not keep. A clock reads a session's
 * message events as they happen and times each message from its first streamed output (text,
 * thinking or a tool call) to its end, so request queueing, provider retries, prompt processing
 * before the first token, tool execution and waits on the user all stay out of the token rate.
 * The finished timing is persisted as an `app-generation` session entry, which never reaches the
 * model, so cold projections show what the live view did. The clock also times how long each
 * thinking part streamed, persisted as an `app-thinking` entry as soon as the thought ends, so its
 * block shows the reasoning time while the rest of the message still streams.
 */
export const APP_GENERATION = 'app-generation';
export const APP_THINKING = 'app-thinking';

const GenerationRecordSchema = Type.Object(
  {
    /** The assistant message's own `timestamp`, which identifies it in the branch. */
    timestamp: Type.Number(),
    durationMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type GenerationRecord = Static<typeof GenerationRecordSchema>;

const ThinkingRecordSchema = Type.Object(
  {
    /** The thought's block id (`thinkingBlockId`), which identifies it in the branch. */
    blockId: Type.String({ maxLength: 256 }),
    durationMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ThinkingRecord = Static<typeof ThinkingRecordSchema>;

// Compiled once: every reprojection reads each custom entry on the branch through them.
const GenerationRecordValidator = Compile(GenerationRecordSchema);
const ThinkingRecordValidator = Compile(ThinkingRecordSchema);

/** A custom entry's data as a generation record, or null for other entries and shapes. */
export function readGenerationRecord(customType: string, data: unknown): GenerationRecord | null {
  return customType === APP_GENERATION && GenerationRecordValidator.Check(data) ? data : null;
}

/** A custom entry's data as a thinking record, or null for other entries and shapes. */
export function readThinkingRecord(customType: string, data: unknown): ThinkingRecord | null {
  return customType === APP_THINKING && ThinkingRecordValidator.Check(data) ? data : null;
}

/**
 * The id of the thinking block projected from content part `index` of the assistant message
 * `timestamp`. Thinking records persist it, so its format must not change.
 */
export function thinkingBlockId(timestamp: number, index: number): string {
  return `t:${timestamp}:${index}`;
}

/** A session entry a clock hands its owner to record. */
export type GenerationEntry =
  | { customType: typeof APP_GENERATION; data: GenerationRecord }
  | { customType: typeof APP_THINKING; data: ThinkingRecord };

/**
 * The shortest stream a rate can be read from. Output that arrives at once (a provider sending a
 * whole tool call in one chunk) or a message of a few tokens spans less, and its rate would only
 * reflect delivery; such a message stays untimed instead of skewing its turn.
 */
const MIN_STREAM_MS = 250;

type AgentMessage = AgentSession['messages'][number];

/** The session events a clock reads; Pi delivers them alike to listeners and extensions. */
export type GenerationEvent =
  | { type: 'message_start' | 'message_end'; message: AgentMessage }
  | {
      type: 'message_update';
      message: AgentMessage;
      assistantMessageEvent: AssistantMessageEvent;
    };

interface OpenMessage {
  /** Pi's `message_start`: the provider's response began. */
  respondedAt: number;
  firstOutputAt: number | null;
  /** The first output was thinking, so reasoning streamed from its start. */
  thoughtFirst: boolean;
  /** When each thinking part that has not ended yet started, by content index. */
  thoughts: Map<number, number>;
}

/** Times the assistant messages of one session and their thoughts; keyed by message `timestamp`. */
export class GenerationClock {
  private readonly open = new Map<number, OpenMessage>();

  /**
   * Reads one session event and returns what to record now: an `app-thinking` entry for each
   * thought it ended and, at an assistant message's end, its `app-generation` entry when timed.
   */
  observe(event: GenerationEvent): GenerationEntry[] {
    const { message } = event;
    if (message.role !== 'assistant') return [];
    const now = Date.now();
    if (event.type === 'message_start') {
      this.open.set(message.timestamp, {
        respondedAt: now,
        firstOutputAt: null,
        thoughtFirst: false,
        thoughts: new Map(),
      });
      return [];
    }
    const entry = this.open.get(message.timestamp);
    if (!entry) return [];
    if (event.type === 'message_update') {
      // Pi raises updates only for text, thinking and tool call parts, from their `*_start`.
      const part = event.assistantMessageEvent;
      if (!('contentIndex' in part)) return [];
      if (entry.firstOutputAt === null) {
        entry.firstOutputAt = now;
        entry.thoughtFirst = part.type.startsWith('thinking');
      }
      // Parts stream in order, so a thought ends at its `thinking_end` or at the first event of a
      // later part, whichever comes first: openai-completions ends every part only with the stream.
      const last = part.type === 'thinking_end' ? part.contentIndex : part.contentIndex - 1;
      const ended = endThoughts(message.timestamp, entry, last, now);
      if (part.type === 'thinking_start') entry.thoughts.set(part.contentIndex, now);
      return ended;
    }
    this.open.delete(message.timestamp);
    // A thought still open here was cut off with its message, which failed or was stopped.
    const ended = endThoughts(message.timestamp, entry, Number.POSITIVE_INFINITY, now);
    const record = settle(entry, message, now);
    return record ? [...ended, { customType: APP_GENERATION, data: record }] : ended;
  }

  /** When the streaming message `timestamp` showed its first output; undefined until it did. */
  firstOutputAt(timestamp: number): number | undefined {
    return this.open.get(timestamp)?.firstOutputAt ?? undefined;
  }
}

/**
 * A finished message's record. Failed and stopped messages carry no reliable output count, so
 * they stay untimed. Reasoning a provider reports but did not stream ran before the first output,
 * so such a message is timed from the response start, the closest bound that holds it.
 */
function settle(
  entry: OpenMessage,
  message: AssistantMessage,
  endedAt: number,
): GenerationRecord | null {
  if (entry.firstOutputAt === null) return null;
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return null;
  const hiddenReasoning = !entry.thoughtFirst && (message.usage.reasoning ?? 0) > 0;
  const durationMs = endedAt - (hiddenReasoning ? entry.respondedAt : entry.firstOutputAt);
  return durationMs < MIN_STREAM_MS ? null : { timestamp: message.timestamp, durationMs };
}

/** Ends the open thoughts of message `timestamp` up to content index `last`, as their entries. */
function endThoughts(
  timestamp: number,
  entry: OpenMessage,
  last: number,
  endedAt: number,
): GenerationEntry[] {
  const ended: GenerationEntry[] = [];
  for (const [index, startedAt] of entry.thoughts) {
    if (index > last) continue;
    entry.thoughts.delete(index);
    // Wall-clock time, so a clock adjustment mid-thought must not yield a negative span.
    const durationMs = Math.max(0, endedAt - startedAt);
    ended.push({
      customType: APP_THINKING,
      data: { blockId: thinkingBlockId(timestamp, index), durationMs },
    });
  }
  return ended;
}
