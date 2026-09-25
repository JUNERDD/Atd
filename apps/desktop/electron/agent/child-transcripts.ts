import { BrowserWindow, type WebContents } from 'electron';
import type { AgentHttpClient } from '@ai/agent-client';
import { ChildTranscriptPatchDataSchema, ServiceBlockSchema } from '@ai/agent-contracts';
import { sendToPage } from '../window-content';
import type { AgentEvent, ChildTranscriptDetail } from './bridge';
import { AGENT_IPC } from './ipc-channels';
import { mapBlock } from './service-map';
import { applyTranscriptPatch, type Block, type ChildTranscriptPatch } from './transcript-schema';
import { parse } from './validation';

/** Patches kept while a snapshot loads; a longer burst is recovered by the next reload. */
const MAX_BUFFERED = 200;

interface ChildEntry {
  taskId: string;
  childKey: string;
  /** Hold count per window; the entry exists only while some window holds it. */
  subscribers: Map<WebContents, number>;
  state: { revision: number; blocks: Block[]; live: boolean } | null;
  loading: Promise<void> | null;
  /** Patches that arrived while `state` was missing or loading, in arrival order. */
  buffered: ChildTranscriptPatch[];
}

/**
 * Child session transcripts for the windows that asked for them. Main keeps state only for
 * `(taskId, childKey)` pairs some window holds, forwards `child.transcript.patch` events to those
 * windows only, and reseeds from the snapshot endpoint on the first hold or a revision gap.
 */
export class ChildTranscripts {
  private readonly entries = new Map<string, Map<string, ChildEntry>>();
  private readonly watched = new Set<WebContents>();

  constructor(private readonly http: () => AgentHttpClient) {}

  /**
   * Adds one hold for `sender` and resolves with the current transcript. The hold stays when
   * loading fails, so the caller's paired release still balances it; the next patch retries.
   */
  async subscribe(
    sender: WebContents,
    taskId: string,
    childKey: string,
  ): Promise<ChildTranscriptDetail> {
    const entry = this.hold(sender, taskId, childKey);
    if (!entry.state || entry.loading) await this.reload(entry);
    const state = entry.state;
    if (!state) throw new Error('The subagent transcript is unavailable.');
    return structuredClone({ taskId, childKey, ...state });
  }

  release(sender: WebContents, taskId: string, childKey: string) {
    const entry = this.entries.get(taskId)?.get(childKey);
    const count = entry?.subscribers.get(sender);
    if (!entry || count === undefined) return;
    if (count > 1) entry.subscribers.set(sender, count - 1);
    else entry.subscribers.delete(sender);
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

  private hold(sender: WebContents, taskId: string, childKey: string): ChildEntry {
    this.watch(sender);
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
    entry.subscribers.set(sender, (entry.subscribers.get(sender) ?? 0) + 1);
    return entry;
  }

  /**
   * A destroyed window cannot release, and a reloaded page starts without holds, so both drop
   * every hold of that webContents.
   */
  private watch(sender: WebContents) {
    if (this.watched.has(sender)) return;
    this.watched.add(sender);
    const drop = () => this.dropSender(sender);
    sender.on('did-navigate', drop);
    sender.once('destroyed', () => {
      this.watched.delete(sender);
      drop();
    });
  }

  private dropSender(sender: WebContents) {
    for (const children of this.entries.values())
      for (const entry of children.values())
        if (entry.subscribers.delete(sender) && !entry.subscribers.size) this.remove(entry);
  }

  private remove(entry: ChildEntry) {
    const children = this.entries.get(entry.taskId);
    if (children?.get(entry.childKey) !== entry) return;
    children.delete(entry.childKey);
    if (!children.size) this.entries.delete(entry.taskId);
  }

  private isHeld(entry: ChildEntry) {
    return this.entries.get(entry.taskId)?.get(entry.childKey) === entry;
  }

  /** Loads the snapshot once at a time, replays newer buffered patches, and reseeds holders. */
  private reload(entry: ChildEntry): Promise<void> {
    entry.loading ??= this.load(entry).finally(() => {
      entry.loading = null;
    });
    return entry.loading;
  }

  private async load(entry: ChildEntry) {
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

  private forward(entry: ChildEntry, patch: ChildTranscriptPatch) {
    const event: AgentEvent = { type: 'childTranscript', patch };
    for (const sender of entry.subscribers.keys())
      if (!sender.isDestroyed())
        sendToPage(BrowserWindow.fromWebContents(sender), AGENT_IPC.changed, event);
  }
}
