import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import type { ServiceBlock } from '@atd/agent-contracts';
import { GenerationClock } from '../generation.js';
import { STREAM_COALESCE_MS } from '../live-transcript.js';
import { TrailingFlush } from '../trailing-flush.js';
import {
  diffServiceBlocks,
  projectServiceBlocks,
  toolPartialText,
  type ServiceBranchItem,
} from '../transcript.js';
import type { ChildRecord, SubagentHost } from './registry.js';

type SessionListener = Parameters<AgentSession['subscribe']>[0];
type AgentMessage = AgentSession['messages'][number];

/** The pi-subagents `ChildSession` surface (runs/shared/child-session.js) a live transcript reads. */
export interface ChildTranscriptSource {
  subscribe(listener: SessionListener): () => void;
  readonly messages: readonly AgentMessage[];
}

/** What a live child transcript needs from its parent task (registry.ts `SubagentHost`). */
export type ChildTranscriptHost = Pick<
  SubagentHost,
  'publishChildTranscript' | 'parentPermissions'
>;

/**
 * Live transcript of one foreground child session, keyed by `record.key`. Like the parent's
 * LiveTranscript it reprojects on every child event with the same `projectServiceBlocks`, so block
 * ids match the cold projection of the child JSONL; the branch is the child's messages, stamped
 * with the time each ended as the session entry would be. Patches go out as
 * `child.transcript.patch`, and the revision advances only with a published patch so a client can
 * detect a gap. Approvals of the child's tools are recorded in the parent session and joined in,
 * read once per reprojection. Streamed deltas coalesce as the parent's do (`STREAM_COALESCE_MS`).
 * Generation and thinking times are measured here as the parent's are and joined in as the entries
 * the child's bridge records in its session (child-bridge.ts).
 */
class LiveChildTranscript {
  private blocks: ServiceBlock[] = [];
  private revision = 0;
  private readonly streamed = new TrailingFlush(() => this.reproject(true), STREAM_COALESCE_MS);
  private partial: AssistantMessage | undefined;
  private readonly partials = new Map<string, string>();
  /** When each message ended, by message identity (Pi pushes the `message_end` object). */
  private readonly endedAt = new WeakMap<object, number>();
  private readonly generation = new GenerationClock();
  /** The clock's entries, as the bridge records them in the child's session. */
  private readonly timings: ServiceBranchItem[] = [];
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly record: ChildRecord,
    private readonly host: ChildTranscriptHost,
    private readonly source: ChildTranscriptSource,
  ) {}

  attach(): void {
    this.unsubscribe = this.source.subscribe((event) => {
      if (
        event.type === 'message_start' ||
        event.type === 'message_update' ||
        event.type === 'message_end'
      ) {
        for (const entry of this.generation.observe(event))
          this.timings.push({ type: 'custom', ...entry });
      }
      if (event.type === 'message_update' && event.message.role === 'assistant')
        this.partial = event.message;
      if (event.type === 'message_end') {
        this.endedAt.set(event.message, Date.now());
        if (event.message.role === 'assistant') this.partial = undefined;
      }
      if (event.type === 'tool_execution_update')
        this.partials.set(event.toolCallId, toolPartialText(event.partialResult));
      if (event.type === 'tool_execution_end') this.partials.delete(event.toolCallId);
      if (event.type === 'message_update' || event.type === 'tool_execution_update')
        this.streamed.schedule();
      else this.reproject(true);
    });
  }

  snapshot(): { revision: number; blocks: ServiceBlock[] } {
    this.streamed.flush();
    return { revision: this.revision, blocks: [...this.blocks] };
  }

  /**
   * Stops following the child and publishes its settled projection: calls it left open read as
   * interrupted, as the cold path shows them from then on.
   */
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.partial = undefined;
    this.partials.clear();
    this.reproject(false);
  }

  /** Drops the subscription without publishing (task teardown). */
  forget(): void {
    this.streamed.cancel();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private reproject(live: boolean): void {
    this.streamed.cancel();
    const messages = this.source.messages.map((message): ServiceBranchItem => {
      const endedAt = this.endedAt.get(message);
      return { type: 'message', message, ...(endedAt === undefined ? {} : { endedAt }) };
    });
    const next = projectServiceBlocks({
      branch: [...messages, ...this.timings],
      partial: this.partial,
      firstTokenAt: this.partial && this.generation.firstOutputAt(this.partial.timestamp),
      partials: this.partials,
      firstRunId: this.record.parentRunId,
      live,
      permissions: this.host.parentPermissions(),
    });
    const patch = diffServiceBlocks(this.blocks, next);
    this.blocks = next;
    if (!patch.blocks.length && !patch.removed.length) return;
    this.revision += 1;
    this.host.publishChildTranscript(
      { runId: this.record.parentRunId, executionId: this.record.executionId },
      {
        childKey: this.record.key,
        revision: this.revision,
        snapshot: false,
        blocks: patch.blocks,
        removed: patch.removed,
      },
    );
  }
}

/** Live child transcripts by task id, then child key; entries leave when their child ends. */
const liveByTask = new Map<string, Map<string, LiveChildTranscript>>();

/**
 * Follows one created child session until the returned close runs (the child's dispose); the
 * endpoint serves its snapshot meanwhile and cold-projects the child JSONL afterwards.
 */
export function startChildTranscript(
  record: ChildRecord,
  host: ChildTranscriptHost,
  source: ChildTranscriptSource,
): () => void {
  const transcript = new LiveChildTranscript(record, host, source);
  const children = liveByTask.get(record.taskId) ?? new Map<string, LiveChildTranscript>();
  children.set(record.key, transcript);
  liveByTask.set(record.taskId, children);
  transcript.attach();
  return () => {
    if (children.get(record.key) !== transcript) return;
    children.delete(record.key);
    if (!children.size && liveByTask.get(record.taskId) === children)
      liveByTask.delete(record.taskId);
    transcript.close();
  };
}

/** The live snapshot of a running child, or null once it ended (or never ran here). */
export function liveChildTranscript(
  taskId: string,
  childKey: string,
): { revision: number; blocks: ServiceBlock[] } | null {
  return liveByTask.get(taskId)?.get(childKey)?.snapshot() ?? null;
}

/** Drops every live child transcript of a task without publishing (runner disposal). */
export function forgetChildTranscripts(taskId: string): void {
  for (const transcript of liveByTask.get(taskId)?.values() ?? []) transcript.forget();
  liveByTask.delete(taskId);
}
