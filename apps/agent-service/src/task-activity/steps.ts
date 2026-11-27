import {
  isTerminalStatus,
  SHOW_UI_TOOL,
  RunStatusSchema,
  TASK_ACTIVITY_REPLY_CHARS,
  type RunStatus,
  type ServiceEvent,
  type TaskActivityReply,
  type TaskActivityStep,
} from '@atd/agent-contracts';
import { Value } from 'typebox/value';
import type { EventLog } from '../event-log.js';
import { createClamp } from '../transcript-details/clamp.js';
import { TrailingFlush } from '../trailing-flush.js';

/**
 * A reply that only grew is reported at most this often: a few updates a second read as streaming
 * text without resending the activity snapshot at the transcript's frame rate.
 */
const REPLY_COALESCE_MS = 100;

/** Tool families a step names; any other tool call is a generic `tool` step. */
const TOOL_STEPS: Readonly<Record<string, TaskActivityStep>> = {
  bash: 'command',
  command: 'command',
  read: 'reading',
  grep: 'reading',
  find: 'reading',
  ls: 'reading',
  memory_read: 'reading',
  memory_search: 'reading',
  write: 'editing',
  edit: 'editing',
};

interface LiveBlock {
  step: TaskActivityStep;
  at: number;
  /** The call id of a running `show_ui` call: a view that may be waiting for the user. */
  viewCallId?: string;
}

/** A run's latest assistant block with text: the message it is writing, or wrote last. */
interface LiveReply {
  id: string;
  text: string;
  at: number;
}

/**
 * Each active run's current step and latest message, followed from the root transcript patches
 * it publishes. Only the run's live blocks are kept for its step (a streaming thought or reply, a
 * running tool call), so the step is the latest of them and none between steps; its message stays
 * until a newer one replaces it. A run forgets both when it ends. A change of step reaches the
 * listeners at once; a message that only changed its text, at most every `REPLY_COALESCE_MS`.
 */
export class TaskStepBoard {
  private readonly runs = new Map<string, Map<string, LiveBlock>>();
  private readonly replies = new Map<string, LiveReply>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly replied = new TrailingFlush(() => this.notify(), REPLY_COALESCE_MS);

  constructor(events: Pick<EventLog, 'onPublish'>) {
    this.unsubscribe = events.onPublish((event) => this.receive(event));
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current(taskId: string, runId: string): TaskActivityStep | undefined {
    let latest: LiveBlock | undefined;
    for (const block of this.runs.get(key(taskId, runId))?.values() ?? [])
      if (!latest || block.at >= latest.at) latest = block;
    return latest?.step;
  }

  /** The run's latest message as far as it has been written, clipped to the row's limit. */
  reply(taskId: string, runId: string): TaskActivityReply | undefined {
    const reply = this.replies.get(key(taskId, runId));
    if (!reply) return undefined;
    const clamp = createClamp();
    const text = clamp.text(reply.text, TASK_ACTIVITY_REPLY_CHARS);
    return { text, clipped: clamp.truncated };
  }

  /**
   * The ids of the run's `show_ui` calls still running. A view that waits for the user's response
   * keeps its call running while its input request is pending, and the request carries the call's
   * id (`PermissionRequest.toolCallId`); a view that does not wait finishes at once.
   */
  viewCalls(taskId: string, runId: string): ReadonlySet<string> {
    const calls = new Set<string>();
    for (const block of this.runs.get(key(taskId, runId))?.values() ?? [])
      if (block.viewCallId !== undefined) calls.add(block.viewCallId);
    return calls;
  }

  dispose(): void {
    this.unsubscribe();
    this.replied.cancel();
    this.listeners.clear();
    this.runs.clear();
    this.replies.clear();
  }

  private receive(event: ServiceEvent): void {
    const runId = event.runId;
    if (!runId) return;
    const runKey = key(event.taskId, runId);
    const before = this.fingerprint(event.taskId, runId);
    const reply = this.replies.get(runKey)?.text;
    if (event.type === 'run.status') {
      const status = runStatus(event.data);
      if (status && isTerminalStatus(status)) {
        this.runs.delete(runKey);
        this.replies.delete(runKey);
      }
    } else if (event.type === 'transcript.patch') {
      this.patch(runKey, runId, event.data);
    } else return;
    if (this.fingerprint(event.taskId, runId) !== before) {
      // Listeners read every run's current state, a reply that was waiting included.
      this.replied.cancel();
      this.notify();
    } else if (this.replies.get(runKey)?.text !== reply) this.replied.schedule();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** What listeners can see of a run: its current step and its running views. */
  private fingerprint(taskId: string, runId: string): string {
    return JSON.stringify([this.current(taskId, runId), [...this.viewCalls(taskId, runId)].sort()]);
  }

  /**
   * A snapshot replaces the run's blocks and its message; a reload carries none, so the last known
   * step and message stay.
   */
  private patch(runKey: string, runId: string, data: unknown): void {
    if (!isRecord(data) || data.reload === true) return;
    const blocks =
      data.snapshot === true
        ? new Map<string, LiveBlock>()
        : (this.runs.get(runKey) ?? new Map<string, LiveBlock>());
    let reply = data.snapshot === true ? undefined : this.replies.get(runKey);
    if (Array.isArray(data.removed))
      for (const id of data.removed) {
        if (typeof id !== 'string') continue;
        blocks.delete(id);
        if (reply?.id === id) reply = undefined;
      }
    if (Array.isArray(data.blocks))
      for (const block of data.blocks) {
        if (!isRecord(block) || typeof block.id !== 'string' || block.runId !== runId) continue;
        reply = laterReply(reply, block.id, block);
        const step = liveStep(block);
        if (step) {
          const live: LiveBlock = { step, at: Number(block.timestamp) || 0 };
          if (block.name === SHOW_UI_TOOL && typeof block.callId === 'string')
            live.viewCallId = block.callId;
          blocks.set(block.id, live);
        } else blocks.delete(block.id);
      }
    if (blocks.size) this.runs.set(runKey, blocks);
    else this.runs.delete(runKey);
    if (reply) this.replies.set(runKey, reply);
    else this.replies.delete(runKey);
  }
}

/**
 * `block` as the run's message when it is an assistant block with text that is not older than
 * `current` (the same block, streaming on, or a later one); else `current`. A message without
 * text (only tool calls) leaves the one before it, as the run's answer skips it too.
 */
function laterReply(
  current: LiveReply | undefined,
  id: string,
  block: Record<string, unknown>,
): LiveReply | undefined {
  if (block.kind !== 'assistant' || typeof block.text !== 'string' || !block.text.trim())
    return current;
  const at = Number(block.timestamp) || 0;
  if (current && current.id !== id && at < current.at) return current;
  return { id, text: block.text, at };
}

/** Blocks follow `ServiceBlockSchema`; the event log carries them untyped. */
function liveStep(block: Record<string, unknown>): TaskActivityStep | undefined {
  switch (block.kind) {
    case 'thinking':
      return block.streaming === true ? 'thinking' : undefined;
    case 'assistant':
      return block.streaming === true ? 'responding' : undefined;
    case 'tool':
      if (block.status !== 'running') return undefined;
      return typeof block.name === 'string' && Object.hasOwn(TOOL_STEPS, block.name)
        ? TOOL_STEPS[block.name]
        : 'tool';
    default:
      return undefined;
  }
}

function runStatus(data: unknown): RunStatus | undefined {
  return isRecord(data) && Value.Check(RunStatusSchema, data.status) ? data.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function key(taskId: string, runId: string): string {
  return `${taskId}/${runId}`;
}
