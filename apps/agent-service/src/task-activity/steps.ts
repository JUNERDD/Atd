import {
  isTerminalStatus,
  SHOW_UI_TOOL,
  RunStatusSchema,
  type RunStatus,
  type ServiceEvent,
  type TaskActivityStep,
} from '@atd/agent-contracts';
import { Value } from 'typebox/value';
import type { EventLog } from '../event-log.js';

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

/**
 * Each active run's current step, followed from the root transcript patches it publishes. Only
 * the run's live blocks are kept (a streaming thought or reply, a running tool call), so the step
 * is the latest of them and none between steps. A run forgets them when it ends.
 */
export class TaskStepBoard {
  private readonly runs = new Map<string, Map<string, LiveBlock>>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

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
    this.listeners.clear();
    this.runs.clear();
  }

  private receive(event: ServiceEvent): void {
    const runId = event.runId;
    if (!runId) return;
    const runKey = key(event.taskId, runId);
    const before = this.fingerprint(event.taskId, runId);
    if (event.type === 'run.status') {
      const status = runStatus(event.data);
      if (status && isTerminalStatus(status)) this.runs.delete(runKey);
    } else if (event.type === 'transcript.patch') {
      this.patch(runKey, runId, event.data);
    } else return;
    if (this.fingerprint(event.taskId, runId) !== before)
      for (const listener of this.listeners) listener();
  }

  /** What listeners can see of a run: its current step and its running views. */
  private fingerprint(taskId: string, runId: string): string {
    return JSON.stringify([this.current(taskId, runId), [...this.viewCalls(taskId, runId)].sort()]);
  }

  /** A snapshot replaces the run's blocks; a reload carries none, so the last known step stays. */
  private patch(runKey: string, runId: string, data: unknown): void {
    if (!isRecord(data) || data.reload === true) return;
    const blocks =
      data.snapshot === true
        ? new Map<string, LiveBlock>()
        : (this.runs.get(runKey) ?? new Map<string, LiveBlock>());
    if (Array.isArray(data.removed))
      for (const id of data.removed) if (typeof id === 'string') blocks.delete(id);
    if (Array.isArray(data.blocks))
      for (const block of data.blocks) {
        if (!isRecord(block) || typeof block.id !== 'string' || block.runId !== runId) continue;
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
  }
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
