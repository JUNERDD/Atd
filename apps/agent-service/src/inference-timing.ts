import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

export const APP_INFERENCE = 'app-inference';

/**
 * One inference from Pi's turn_start, before request/context preparation, through the assistant
 * message's end. This includes preparation and provider waiting, but excludes tool execution and
 * between-turn preparation such as compaction. It is not a provider-only latency measurement.
 */
export interface InferenceRecord {
  startedAt: number;
  /** Absent only when the inference ended before Pi emitted an assistant message. */
  timestamp?: number;
  durationMs: number;
  /** Time to actual content; absent when no output arrived, including early failures. */
  firstOutputMs?: number;
  outcome: 'completed' | 'error' | 'aborted' | 'interrupted';
}

type AgentMessage = AgentSession['messages'][number];

export type InferenceTimingEvent =
  | { type: 'turn_start' }
  | { type: 'agent_end' }
  | { type: 'message_start' | 'message_end'; message: AgentMessage }
  | {
      type: 'message_update';
      message: AgentMessage;
      assistantMessageEvent: AssistantMessageEvent;
    };

interface PendingInference {
  startedAt: number;
  timestamp?: number;
  firstOutputAt?: number;
}

/** Per-session inference timing, independent of the streaming clock used for token rates. */
export class InferenceClock {
  private pending: PendingInference | undefined;

  observe(event: InferenceTimingEvent): InferenceRecord[] {
    const now = Date.now();
    if (event.type === 'turn_start' || event.type === 'agent_end') {
      const previous = this.finish(now, 'interrupted');
      if (event.type === 'turn_start') this.pending = { startedAt: now };
      return previous;
    }
    const { message } = event;
    const pending = this.pending;
    if (message.role !== 'assistant' || !pending) return [];
    pending.timestamp ??= message.timestamp;
    if (pending.timestamp !== message.timestamp) return [];
    if (event.type === 'message_update') {
      if (hasOutput(event.assistantMessageEvent)) pending.firstOutputAt ??= now;
      return [];
    }
    if (event.type !== 'message_end') return [];
    // Some providers deliver a complete part/message without deltas. Count that as output only
    // when it arrives, never backdate it to an empty *_start or a request timestamp.
    if (message.content.some(hasContent)) pending.firstOutputAt ??= now;
    return this.finish(
      now,
      message.stopReason === 'error' || message.stopReason === 'aborted'
        ? message.stopReason
        : 'completed',
    );
  }

  private finish(now: number, outcome: InferenceRecord['outcome']): InferenceRecord[] {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return [];
    return [
      {
        startedAt: pending.startedAt,
        ...(pending.timestamp === undefined ? {} : { timestamp: pending.timestamp }),
        durationMs: Math.max(0, now - pending.startedAt),
        ...(pending.firstOutputAt === undefined
          ? {}
          : { firstOutputMs: Math.max(0, pending.firstOutputAt - pending.startedAt) }),
        outcome,
      },
    ];
  }
}

function hasOutput(event: AssistantMessageEvent): boolean {
  const part = 'contentIndex' in event ? event.partial.content[event.contentIndex] : undefined;
  if (part?.type === 'thinking' && part.redacted) return false;
  switch (event.type) {
    case 'text_start':
    case 'thinking_start':
    case 'toolcall_start':
      return part !== undefined && hasContent(part);
    case 'text_delta':
    case 'thinking_delta':
    case 'toolcall_delta':
      return event.delta.trim().length > 0;
    case 'text_end':
    case 'thinking_end':
      return event.content.trim().length > 0;
    case 'toolcall_end':
      return event.toolCall.name.trim().length > 0;
    case 'start':
    case 'done':
    case 'error':
      return false;
  }
}

function hasContent(part: AssistantMessage['content'][number]): boolean {
  if (part.type === 'text') return part.text.trim().length > 0;
  if (part.type === 'thinking') return !part.redacted && part.thinking.trim().length > 0;
  return part.type === 'toolCall' && part.name.trim().length > 0;
}
