import type { AgentHttpClient } from '@atd/agent-client';
import { ChildTranscriptPatchDataSchema, ServiceBlockSchema } from '@atd/agent-contracts';
import type { AgentEvent, ChildTranscriptDetail } from './bridge';
import { mapBlock } from './service-map';
import { applyTranscriptPatch, type Block, type ChildTranscriptPatch } from './transcript-schema';
import { parse } from './validation';

/** Patches kept while a snapshot loads; a longer burst is recovered by the next reload. */
const MAX_BUFFERED = 200;

interface ChildEntry<S> {
  taskId: string;
  childKey: string;
  /** Hold count per subscriber; the entry exists only while some subscriber holds it. */
  subscribers: Map<S, number>;
  state: { revision: number; blocks: Block[]; live: boolean } | null;
  loading: Promise<void> | null;
  /** Patches that arrived while `state` was missing or loading, in arrival order. */
  buffered: ChildTranscriptPatch[];
}

/**
 * Child session transcripts for the subscribers that asked for them: renderer windows in the
 * desktop, the page itself in the web client. State is kept only for `(taskId, childKey)` pairs
 * some subscriber holds; `child.transcript.patch` events reach those subscribers only, and the
 * snapshot endpoint reseeds on the first hold or a revision gap. A subscriber that goes away
 * without releasing (a closed or reloaded window) is dropped through `dropSubscriber`.
 */
export class ChildTranscripts<S> {
  private readonly entries = new Map<string, Map<string, ChildEntry<S>>>();

  constructor(
    private readonly http: () => AgentHttpClient,
    private readonly forwardTo: (subscriber: S, event: AgentEvent) => void,
  ) {}

  /**
   * Adds one hold for `subscriber` and resolves with the current transcript. The hold stays when
   * loading fails, so the caller's paired release still balances it; the next patch retries.
   */
  async subscribe(subscriber: S, taskId: string, childKey: string): Promise<ChildTranscriptDetail> {
    const entry = this.hold(subscriber, taskId, childKey);
    if (!entry.state || entry.loading) await this.reload(entry);
    const state = entry.state;
    if (!state) throw new Error('The subagent transcript is unavailable.');
    return structuredClone({ taskId, childKey, ...state });
  }

  release(subscriber: S, taskId: string, childKey: string) {
    const entry = this.entries.get(taskId)?.get(childKey);
    const count = entry?.subscribers.get(subscriber);
    if (!entry || count === undefined) return;
    if (count > 1) entry.subscribers.set(subscriber, count - 1);
    else entry.subscribers.delete(subscriber);
    if (!entry.subscribers.size) this.remove(entry);
  }

  /**
   * Applies a service `child.transcript.patch`. Children no window holds are skipped before any
   * block is validated or mapped; invalid data throws to the event loop's catch.
   */
  onPatch(taskId: string, data: unknown) {
    const children = this.entries.get(taskId);
    if (!children) return;
    const raw = parse(ChildTranscriptPatchDataSchema, data);
    const entry = children.get(raw.childKey);
    if (!entry) return;
    const patch: ChildTranscriptPatch = {
      taskId,
      childKey: raw.childKey,
      revision: raw.revision,
      snapshot: raw.snapshot,
      blocks: raw.blocks.map((block) => mapBlock(parse(ServiceBlockSchema, block))),
      removed: raw.removed,
    };
    if (!entry.state || entry.loading) {
      if (entry.buffered.length < MAX_BUFFERED) entry.buffered.push(patch);
      if (!entry.loading) void this.reload(entry).catch(() => undefined);
      return;
    }
    const next = applyTranscriptPatch(entry.state, patch);
    if (!next) {
      void this.reload(entry).catch(() => undefined);
      return;
    }
    entry.state = { ...entry.state, ...next };
    this.forward(entry, patch);
  }

  /** Drops a deleted task's children; later releases for them are no-ops. */
  forgetTask(taskId: string) {
    this.entries.delete(taskId);
  }

  clear() {
    this.entries.clear();
  }

  /** Drops every hold of a subscriber that can no longer release (closed or reloaded). */
  dropSubscriber(subscriber: S) {
    for (const children of this.entries.values())
      for (const entry of children.values())
        if (entry.subscribers.delete(subscriber) && !entry.subscribers.size) this.remove(entry);
  }

  private hold(subscriber: S, taskId: string, childKey: string): ChildEntry<S> {
    let children = this.entries.get(taskId);
    if (!children) this.entries.set(taskId, (children = new Map()));
    let entry = children.get(childKey);
    if (!entry) {
      entry = {
        taskId,
        childKey,
        subscribers: new Map(),
        state: null,
        loading: null,
        buffered: [],
      };
      children.set(childKey, entry);
    }
    entry.subscribers.set(subscriber, (entry.subscribers.get(subscriber) ?? 0) + 1);
    return entry;
  }

  private remove(entry: ChildEntry<S>) {
    const children = this.entries.get(entry.taskId);
    if (children?.get(entry.childKey) !== entry) return;
    children.delete(entry.childKey);
    if (!children.size) this.entries.delete(entry.taskId);
  }

  private isHeld(entry: ChildEntry<S>) {
    return this.entries.get(entry.taskId)?.get(entry.childKey) === entry;
  }

  /** Loads the snapshot once at a time, replays newer buffered patches, and reseeds holders. */
  private reload(entry: ChildEntry<S>): Promise<void> {
    entry.loading ??= this.load(entry).finally(() => {
      entry.loading = null;
    });
    return entry.loading;
  }

  private async load(entry: ChildEntry<S>) {
    const response = await this.http().childTranscript(entry.taskId, entry.childKey);
    if (!this.isHeld(entry)) return;
    let state = {
      revision: response.revision,
      blocks: response.blocks.map(mapBlock),
      live: response.live,
    };
    for (const patch of entry.buffered.splice(0)) {
      if (!patch.snapshot && patch.revision <= state.revision) continue;
      const next = applyTranscriptPatch(state, patch);
      // A hole in the buffer is left for the next live patch to detect as a gap.
      if (!next) break;
      state = { ...state, ...next };
    }
    entry.state = state;
    this.forward(entry, {
      taskId: entry.taskId,
      childKey: entry.childKey,
      revision: state.revision,
      snapshot: true,
      blocks: state.blocks,
      removed: [],
    });
  }

  private forward(entry: ChildEntry<S>, patch: ChildTranscriptPatch) {
    const event: AgentEvent = { type: 'childTranscript', patch };
    for (const subscriber of entry.subscribers.keys()) this.forwardTo(subscriber, event);
  }
}
