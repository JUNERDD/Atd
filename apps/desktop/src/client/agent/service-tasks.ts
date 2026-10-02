import type { AgentClientOptions, AgentHttpClient } from '@ai/agent-client';
import type {
  InvalidateFrame,
  ServiceEvent,
  SummariesFrame,
  TaskSnapshot,
  TaskSummary,
} from '@ai/agent-contracts';
import type { AgentEvent, TaskDetail } from './bridge';
import { ChildTranscripts } from './child-transcripts';
import { notConnected } from './service-manage';
import {
  mapSummary,
  mapTranscript,
  taskDetail,
  type TaskSummaryState,
  type TaskTranscript,
} from './service-map';
import { applyTaskEvent } from './task-events';
import { applySummaries } from './task-summaries';

/** The slice of a service connection the task cache uses; desktop and web both provide it. */
export interface TaskConnection {
  http(): AgentHttpClient | null;
  options(): AgentClientOptions | null;
  setTaskHandlers(handlers: {
    onSnapshot: (snapshot: TaskSnapshot) => void;
    onSummaries: (frame: SummariesFrame) => void;
    onEvent: (event: ServiceEvent) => void;
  }): void;
}

export interface TaskHost {
  /** Delivers an event to every client view (all renderer windows, or the web page). */
  emit: (event: AgentEvent) => void;
  /** Republishes the agent snapshot (task list, commands); a burst of calls publishes once. */
  broadcast: () => void;
}

/** A cached task: its summary always, its transcript only while some view holds the task. */
export interface CachedTask extends TaskSummaryState {
  transcript: TaskTranscript | null;
}

/** Loads of one task that answered older than its latest event, before one is kept anyway. */
const LOAD_ATTEMPTS = 3;

/**
 * Service task cache + detail/events, shared by the desktop main process and the web client. The
 * service owns every task; this cache mirrors the summaries and events of the shared stream, so a
 * task another client creates, renames or deletes shows up here too. Transcripts are loaded only
 * for held tasks: `S` identifies a view (a window in the desktop, the page on the web), each view
 * holds the task it last loaded, and a task no view holds keeps its summary only.
 */
export class TaskClient<S> {
  readonly entries = new Map<string, CachedTask>();
  readonly revisions = new Map<string, { revision: number; taskId: string; runId: string }>();
  readonly children: ChildTranscripts<S>;
  /** The task each view shows. */
  private readonly holds = new Map<S, string>();
  /** Loads in flight, so a burst of events for one task loads it once. */
  private readonly reloading = new Map<string, Promise<void>>();
  private readonly summarizing = new Map<string, Promise<void>>();
  /** The stream position of each task's latest event, which a cached load must not predate. */
  private readonly seen = new Map<string, { epoch: number; seq: number }>();

  constructor(
    private readonly connection: TaskConnection,
    readonly host: TaskHost,
    forward: (subscriber: S, event: AgentEvent) => void,
  ) {
    this.children = new ChildTranscripts(() => this.http(), forward);
    connection.setTaskHandlers({
      onSnapshot: (snapshot) => this.onSnapshot(snapshot),
      onSummaries: (frame) => this.onSummaries(frame),
      onEvent: (event) => void this.onEvent(event),
    });
  }

  /**
   * The cached tasks, newest first, as copies. Stream events update the entries in place, and the
   * page's views read what this cache publishes without a process boundary cloning it, so handing
   * out an entry would let a later event change a value a view already compared by identity.
   */
  tasks() {
    return [...this.entries.values()]
      .map((entry) => structuredClone(entry.task))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  clear() {
    this.entries.clear();
    this.seen.clear();
    this.revisions.clear();
    this.holds.clear();
    this.children.clear();
  }

  http() {
    const client = this.connection.http();
    if (!client) throw notConnected();
    return client;
  }

  /**
   * Loads and caches a task's snapshot. With `holder`, that view now shows the task: its
   * transcript stays cached and follows the stream, and the task the view showed before keeps
   * its summary only unless another view holds it.
   */
  async detail(taskId: string, holder?: S): Promise<TaskDetail> {
    if (holder !== undefined) {
      const previous = this.holds.get(holder);
      this.holds.set(holder, taskId);
      if (previous !== undefined && previous !== taskId) this.unload(previous);
    }
    const snapshot = await this.fresh(
      taskId,
      async () => (await this.http().snapshot(taskId)).snapshot,
    );
    return structuredClone(this.cacheSnapshot(snapshot));
  }

  /** A view went away (a closed or reloaded window); the task it showed may unload. */
  release(holder: S) {
    const taskId = this.holds.get(holder);
    this.holds.delete(holder);
    if (taskId !== undefined) this.unload(taskId);
  }

  /** Forgets a deleted task: its entry, the holds on it and its subagent transcripts. */
  forget(taskId: string) {
    this.entries.delete(taskId);
    this.seen.delete(taskId);
    for (const [holder, held] of this.holds) if (held === taskId) this.holds.delete(holder);
    this.children.forgetTask(taskId);
  }

  /** Caches a snapshot's summary, and its transcript while the task is held. */
  cacheSnapshot(snapshot: TaskSnapshot): TaskDetail {
    const entry = this.storeSummary(snapshot);
    const transcript = mapTranscript(snapshot);
    entry.transcript = this.held(snapshot.task.id) ? transcript : null;
    return taskDetail(entry, transcript);
  }

  /** Caches a task's summary, keeping its loaded transcript. */
  storeSummary(summary: TaskSummary): CachedTask {
    const entry: CachedTask = {
      ...mapSummary(summary),
      transcript: this.entries.get(summary.task.id)?.transcript ?? null,
    };
    this.entries.set(summary.task.id, entry);
    for (const request of summary.requests)
      this.revisions.set(request.id, {
        revision: request.revision,
        taskId: request.taskId,
        runId: request.runId,
      });
    return entry;
  }

  /**
   * Publishes a task change: its state to the views that load it, the task list to all. The state
   * is a copy, like `detail()` and `tasks()`: a run's status changes on the cached run in place, so
   * publishing the entry itself would hand a view the same `runs` it already holds, and a view
   * memoized on that identity would keep the run's earlier status.
   */
  publishTask(taskId: string) {
    const entry = this.entries.get(taskId);
    if (entry?.transcript) {
      const { task, requests, queue } = entry;
      this.host.emit({
        type: 'task',
        state: structuredClone({
          task,
          artifacts: [],
          requests,
          queue,
          context: entry.transcript.context,
        }),
      });
    }
    this.host.broadcast();
  }

  /** Loads a task's summary (not its transcript) and publishes it. */
  async loadSummary(taskId: string): Promise<void> {
    const { summary } = await this.fresh(taskId, () => this.http().summary(taskId));
    this.storeSummary(summary);
    this.publishTask(taskId);
  }

  /**
   * `loadSummary` for stream events: a burst for one task loads once. An event that arrives
   * meanwhile is covered, since a summary older than the task's latest event is loaded again.
   */
  refreshSummary(taskId: string): Promise<void> {
    return this.once(this.summarizing, taskId, () => this.loadSummary(taskId));
  }

  /** Reloads a held task's snapshot and republishes it whole, transcript included. */
  reloadTranscript(taskId: string): Promise<void> {
    if (!this.held(taskId)) return Promise.resolve();
    return this.once(this.reloading, taskId, async () =>
      this.publishLoaded(await this.detail(taskId)),
    );
  }

  /** Another client (or this one) renamed, retiered or deleted a task. */
  async onInvalidate(frame: InvalidateFrame) {
    if (!frame.taskId) return;
    if (frame.scope === 'task.deleted') {
      this.forget(frame.taskId);
      this.host.broadcast();
      return;
    }
    if (frame.scope === 'task') await this.loadSummary(frame.taskId).catch(() => undefined);
  }

  private held(taskId: string): boolean {
    for (const held of this.holds.values()) if (held === taskId) return true;
    return false;
  }

  private unload(taskId: string) {
    const entry = this.entries.get(taskId);
    if (entry && !this.held(taskId)) entry.transcript = null;
  }

  /**
   * Loads until the answer is not older than the task's latest event. A load requested before
   * one of the task's events arrived can answer after that event was applied; caching it would
   * roll the event back (a finished run shown as still running, with no later event to correct
   * it), so it is requested again, a bounded number of times.
   */
  private async fresh<T extends { epoch: number; seq: number }>(
    taskId: string,
    load: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const loaded = await load();
      const seen = this.seen.get(taskId);
      const stale = seen !== undefined && seen.epoch === loaded.epoch && seen.seq > loaded.seq;
      if (!stale || attempt === LOAD_ATTEMPTS) return loaded;
    }
  }

  private once(inFlight: Map<string, Promise<void>>, taskId: string, load: () => Promise<void>) {
    let pending = inFlight.get(taskId);
    if (pending) return pending;
    pending = load().finally(() => inFlight.delete(taskId));
    inFlight.set(taskId, pending);
    return pending;
  }

  /** Republishes a freshly cached task, with its transcript as a snapshot patch when loaded. */
  private publishLoaded(detail: TaskDetail) {
    const taskId = detail.task.id;
    this.publishTask(taskId);
    if (!this.entries.get(taskId)?.transcript) return;
    this.host.emit({
      type: 'transcript',
      patch: {
        taskId,
        revision: detail.revision,
        snapshot: true,
        blocks: detail.blocks,
        removed: [],
      },
    });
  }

  /** A per-task stream snapshot (a subscription naming tasks); malformed ones are skipped. */
  private onSnapshot(snapshot: TaskSnapshot) {
    try {
      this.publishLoaded(this.cacheSnapshot(snapshot));
    } catch {
      // Malformed snapshots never break the stream; detail() reloads on demand.
    }
  }

  private onSummaries(frame: SummariesFrame) {
    try {
      applySummaries(this, frame);
    } catch {
      // Malformed summaries never break the stream; the next resubscribe replaces them.
    }
  }

  private async onEvent(event: ServiceEvent) {
    this.seen.set(event.taskId, { epoch: event.epoch, seq: event.seq });
    try {
      // A task this cache has not seen yet (created by another client after the summaries): its
      // summary already contains the event, and a view that loads it gets the transcript.
      if (!this.entries.has(event.taskId)) return await this.refreshSummary(event.taskId);
      await applyTaskEvent(this, event);
    } catch {
      // Stream events never throw; detail() reloads on demand.
    }
  }
}
