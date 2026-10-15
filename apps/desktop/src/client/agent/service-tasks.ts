import type { AgentClientOptions, AgentHttpClient } from '@atd/agent-client';
import type {
  InvalidateFrame,
  ServiceEvent,
  SummariesFrame,
  TaskSnapshot,
  TaskSummary,
} from '@atd/agent-contracts';
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
import { TaskLoads } from './task-replay';
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

/** A cached task while its transcript is loaded. */
type LoadedTask = CachedTask & { transcript: TaskTranscript };

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
  /** Keeps loads in step with the stream events of their tasks. */
  readonly loads = new TaskLoads();

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
    this.loads.clear();
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
    return this.loads.load(
      taskId,
      async () => (await this.http().snapshot(taskId)).snapshot,
      (snapshot): LoadedTask => ({ ...mapSummary(snapshot), transcript: mapTranscript(snapshot) }),
      (snapshot, state) => {
        this.store(snapshot, { ...state, transcript: this.held(taskId) ? state.transcript : null });
        return structuredClone(taskDetail(state, state.transcript));
      },
    );
  }

  /**
   * `detail` after this client changed the task through the service (a submitted or queued run).
   * When `holder` already shows the task, its cached transcript follows the stream, so only the
   * summary loads (with the new run) instead of the whole transcript again.
   */
  async changedDetail(taskId: string, holder?: S): Promise<TaskDetail> {
    if (
      holder === undefined ||
      this.holds.get(holder) !== taskId ||
      !this.entries.get(taskId)?.transcript
    )
      return this.detail(taskId, holder);
    await this.loadSummary(taskId);
    const entry = this.entries.get(taskId);
    // The view moved to another task meanwhile, which unloaded this one's transcript.
    if (!entry?.transcript) return this.detail(taskId);
    return structuredClone(taskDetail(entry, entry.transcript));
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
    this.loads.forget(taskId);
    for (const [holder, held] of this.holds) if (held === taskId) this.holds.delete(holder);
    this.children.forgetTask(taskId);
  }

  /** Caches a stream snapshot's summary, and its transcript while the task is held. */
  cacheSnapshot(snapshot: TaskSnapshot): TaskDetail {
    this.loads.forget(snapshot.task.id);
    const transcript = mapTranscript(snapshot);
    const entry = this.store(snapshot, {
      ...mapSummary(snapshot),
      transcript: this.held(snapshot.task.id) ? transcript : null,
    });
    return taskDetail(entry, transcript);
  }

  /** Caches a task's summary from the stream, keeping its loaded transcript. */
  storeSummary(summary: TaskSummary): CachedTask {
    this.loads.forget(summary.task.id);
    return this.store(summary, {
      ...mapSummary(summary),
      transcript: this.cachedTranscript(summary),
    });
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
    await this.loads.load(
      taskId,
      () => this.http().summary(taskId),
      ({ summary }): CachedTask => ({ ...mapSummary(summary), transcript: null }),
      ({ summary }, state) => {
        this.store(summary, { ...state, transcript: this.cachedTranscript(summary) });
        this.publishTask(taskId);
      },
    );
  }

  /**
   * `loadSummary` for stream events: a burst for one task loads once. An event that arrives
   * meanwhile is covered, since the load in flight replays it onto its answer.
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

  /**
   * Caches `entry` as `summary`'s task, with the revisions answering needs of the requests it
   * still lists: a request resolved after the summary was built is not pending any more, and one
   * raised after it, which a load replays onto `entry`, has its revision from `trackRevisions`.
   */
  private store(summary: TaskSummary, entry: CachedTask): CachedTask {
    this.entries.set(summary.task.id, entry);
    for (const request of summary.requests)
      if (entry.requests.some((item) => item.id === request.id))
        this.revisions.set(request.id, {
          revision: request.revision,
          taskId: request.taskId,
          runId: request.runId,
        });
    return entry;
  }

  /**
   * Keeps the revisions answering needs in step with the stream, cached task or not: the requests
   * a load replays onto its answer (a task's first load too) have their revisions only from here.
   */
  private trackRevisions(event: ServiceEvent) {
    const data = event.data as Record<string, unknown>;
    // A resolved request needs no revision, even when a load already dropped it from the task.
    if (event.type === 'confirm.resolved')
      this.revisions.delete(typeof data['requestId'] === 'string' ? data['requestId'] : '');
    // A load answered after this request was raised listed it with its revision, if still pending.
    if (event.type !== 'confirm.requested' || this.loads.covers(event)) return;
    const raw = data['request'] as TaskSummary['requests'][number];
    this.revisions.set(raw.id, { revision: raw.revision, taskId: raw.taskId, runId: raw.runId });
  }

  /** The transcript the cache follows for a task: a summary load keeps it. */
  private cachedTranscript(summary: TaskSummary): TaskTranscript | null {
    return this.entries.get(summary.task.id)?.transcript ?? null;
  }

  private held(taskId: string): boolean {
    for (const held of this.holds.values()) if (held === taskId) return true;
    return false;
  }

  private unload(taskId: string) {
    const entry = this.entries.get(taskId);
    if (entry && !this.held(taskId)) entry.transcript = null;
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
    this.loads.record(event);
    try {
      this.trackRevisions(event);
      // A task this cache has not seen yet (created by another client after the summaries): its
      // summary already contains the event, and a view that loads it gets the transcript.
      if (!this.entries.has(event.taskId)) return await this.refreshSummary(event.taskId);
      await applyTaskEvent(this, event);
    } catch {
      // Stream events never throw; detail() reloads on demand.
    }
  }
}
