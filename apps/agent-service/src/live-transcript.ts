import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';
import { CODEMODE_TOOL, type QueueState, type ServiceBlock } from '@ai/agent-contracts';
import { NestedStepLog } from './codemode/steps.js';
import type { RunningCompaction } from './compaction/records.js';
import { SUBAGENT_TOOL } from './subagents/tool-contract.js';
import { TrailingFlush } from './trailing-flush.js';
import { subagentRows, type SubagentRow } from './transcript-details/subagent.js';
import {
  diffServiceBlocks,
  fromServiceBranch,
  projectServiceBlocks,
  toolPartialText,
} from './transcript.js';

/**
 * Window in which streamed deltas (`message_update`, `tool_execution_update`) coalesce into one
 * reprojection, about one patch per display frame at 30 fps. Every other event flushes first.
 */
export const STREAM_COALESCE_MS = 33;

export interface TranscriptPatchData {
  revision: number;
  snapshot: boolean;
  blocks: ServiceBlock[];
  removed: string[];
}

export interface LiveTranscriptSink {
  publish: (runId: string, patch: TranscriptPatchData) => void;
  /** The whole pending queue after it changed; clients hold no other live queue source. */
  queue: (runId: string, queue: QueueState) => void;
  sessionFile: (file: string) => void;
}

/**
 * Live transcript of one Pi session. Subscribes to session events, reprojects
 * the 0.99 branch on every change, and publishes patches; the cold path in
 * the runner reuses the same projection so the two cannot diverge. It also
 * publishes Pi's mid-run queue whenever it changes.
 *
 * Streamed deltas reproject at most once per `STREAM_COALESCE_MS`; any other event, a snapshot
 * and disposal publish the owed delta first, so patches keep their order relative to message
 * ends, queue updates and the run status that follows the session's last event. The revision
 * advances only with a published patch: clients apply patch `revision + 1` and reseed on a gap.
 */
export class LiveTranscript {
  private blocks: ServiceBlock[] = [];
  private revision = 0;
  private readonly streamed = new TrailingFlush(() => this.reproject(false), STREAM_COALESCE_MS);
  private readonly partials = new Map<string, string>();
  /**
   * Bounded result rows from each running `subagent` call's latest partial details: its cards
   * track children while the call runs. Other tools' partial details are not kept.
   */
  private readonly subagentProgress = new Map<string, SubagentRow[]>();
  /**
   * Calls running `codemode` scripts made, from the nested `tool_execution_*` events pi reports
   * with `parentToolCallId`; a call's steps leave once it ends, when its result details hold them.
   */
  private readonly codemodeSteps = new NestedStepLog();
  private partial: AssistantMessage | undefined;
  private queue: QueueState = { steering: [], followUp: [] };
  /** Open `batchQueue` edits; their intermediate queue states stay unpublished. */
  private queueBatches = 0;

  constructor(
    private readonly session: AgentSession,
    private readonly manager: SessionManager,
    private readonly sink: LiveTranscriptSink,
    private readonly runId: () => string,
    /** The task's first run (see `ProjectServiceBlocksInput.firstRunId`). */
    private readonly firstRunId: string,
    /** The compaction the session runs now (compaction/observer.ts). */
    private readonly compacting: () => RunningCompaction | null,
  ) {}

  attach(): void {
    this.session.subscribe((event) => {
      if (event.type === 'queue_update') {
        this.streamed.flush();
        this.queue = { steering: [...event.steering], followUp: [...event.followUp] };
        if (this.queueBatches === 0) this.sink.queue(this.runId(), this.queueState());
        return;
      }
      if (event.type === 'message_update' && event.message.role === 'assistant')
        this.partial = event.message;
      if (event.type === 'message_end') {
        if (event.message.role === 'assistant') this.partial = undefined;
        const file = this.session.sessionFile;
        if (file) this.sink.sessionFile(file);
      }
      if (event.type === 'tool_execution_update') {
        this.partials.set(event.toolCallId, toolPartialText(event.partialResult));
        if (event.toolName === SUBAGENT_TOOL)
          this.subagentProgress.set(event.toolCallId, subagentRows(partialDetails(event)));
      }
      if (event.type === 'tool_execution_start' && event.parentToolCallId)
        this.codemodeSteps.start(
          event.parentToolCallId,
          event.toolCallId,
          event.toolName,
          event.args,
        );
      if (event.type === 'tool_execution_end') {
        this.partials.delete(event.toolCallId);
        this.subagentProgress.delete(event.toolCallId);
        if (event.parentToolCallId)
          this.codemodeSteps.end(event.toolCallId, resultParts(event.result), event.isError);
        else if (event.toolName === CODEMODE_TOOL) this.codemodeSteps.take(event.toolCallId);
      }
      if (event.type === 'message_update' || event.type === 'tool_execution_update')
        this.streamed.schedule();
      else this.reproject(false);
    });
  }

  snapshot(): { revision: number; blocks: ServiceBlock[] } {
    this.streamed.flush();
    return { revision: this.revision, blocks: [...this.blocks] };
  }

  queueState(): QueueState {
    return { steering: [...this.queue.steering], followUp: [...this.queue.followUp] };
  }

  /**
   * Runs a multi-step queue edit and publishes only the queue it leaves. Pi can
   * only clear both lists and re-queue, which may span ticks (extension input
   * handlers run per message), and a transient empty queue would close the
   * client's queue view mid-edit.
   */
  async batchQueue<T>(edit: () => Promise<T>): Promise<T> {
    this.queueBatches += 1;
    try {
      return await edit();
    } finally {
      this.queueBatches -= 1;
      if (this.queueBatches === 0) this.sink.queue(this.runId(), this.queueState());
    }
  }

  /** Publishes the owed streamed delta before the session goes away. */
  dispose(): void {
    this.streamed.flush();
  }

  reproject(snapshot: boolean): void {
    this.streamed.cancel();
    const branch = fromServiceBranch(this.manager.getBranch());
    const runId = this.runId();
    const next = projectServiceBlocks({
      branch,
      partial: this.partial,
      partials: this.partials,
      subagentProgress: this.subagentProgress,
      codemodeProgress: this.codemodeSteps.lists,
      firstRunId: this.firstRunId,
      live: true,
      compacting: this.compacting(),
    });
    const patch = diffServiceBlocks(this.blocks, next);
    this.blocks = next;
    if (!patch.blocks.length && !patch.removed.length && !snapshot) return;
    this.revision += 1;
    this.sink.publish(runId, {
      revision: this.revision,
      snapshot,
      blocks: snapshot ? next : patch.blocks,
      removed: snapshot ? [] : patch.removed,
    });
  }
}

/** A tool update's streamed `details` (`AgentToolResult.details`); untrusted until projected. */
function partialDetails(event: { partialResult: unknown }): unknown {
  const partial = event.partialResult;
  return partial && typeof partial === 'object' && 'details' in partial
    ? partial.details
    : undefined;
}

/** A tool result's `content` and `details` (`AgentToolResult`); untrusted until projected. */
function resultParts(result: unknown): { content?: unknown; details?: unknown } {
  return result && typeof result === 'object' ? result : {};
}
