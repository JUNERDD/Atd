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
 * model, so cold projections show what the live view did.
 */
export const APP_GENERATION = 'app-generation';

const GenerationRecordSchema = Type.Object(
  {
    /** The assistant message's own `timestamp`, which identifies it in the branch. */
    timestamp: Type.Number(),
    durationMs: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type GenerationRecord = Static<typeof GenerationRecordSchema>;
/** Compiled once: every reprojection reads each custom entry on the branch through it. */
const GenerationRecordValidator = Compile(GenerationRecordSchema);

/** A custom entry's data as a generation record, or null for other entries and shapes. */
export function readGenerationRecord(customType: string, data: unknown): GenerationRecord | null {
  return customType === APP_GENERATION && GenerationRecordValidator.Check(data) ? data : null;
}

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
      assistantMessageEvent: Pick<AssistantMessageEvent, 'type'>;
    };

interface OpenMessage {
  /** Pi's `message_start`: the provider's response began. */
  respondedAt: number;
  firstOutputAt: number | null;
  /** The first output was thinking, so reasoning streamed from its start. */
  thoughtFirst: boolean;
}

/** Times the assistant messages of one session; keyed by message `timestamp`. */
export class GenerationClock {
  private readonly open = new Map<number, OpenMessage>();

  /** Reads one session event; at an assistant message's end returns its record, when timed. */
  observe(event: GenerationEvent): GenerationRecord | null {
    const { message } = event;
    if (message.role !== 'assistant') return null;
    const now = Date.now();
    if (event.type === 'message_start') {
      this.open.set(message.timestamp, {
        respondedAt: now,
        firstOutputAt: null,
        thoughtFirst: false,
      });
      return null;
    }
    const entry = this.open.get(message.timestamp);
    if (event.type === 'message_update') {
      // Pi raises updates only for text, thinking and tool call parts, from their `*_start`.
      if (entry && entry.firstOutputAt === null) {
        entry.firstOutputAt = now;
        entry.thoughtFirst = event.assistantMessageEvent.type.startsWith('thinking');
      }
      return null;
    }
    this.open.delete(message.timestamp);
    return entry ? settle(entry, message, now) : null;
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
