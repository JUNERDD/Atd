import type { ServiceEvent } from '@atd/agent-contracts';
import type { CachedTask } from './service-tasks';
import { applyEventState } from './task-events';

/** A position in the service's event stream: an answer's, or an event's own. */
interface StreamPosition {
  epoch: number;
  seq: number;
}

/**
 * Events one load keeps; a load still in flight past this drops its oldest. Streaming publishes
 * about 30 patches a second, so this covers a load of several seconds.
 */
const MAX_RECORDED = 500;

/** Loads of one task whose answer the stream could not bring current, before one is kept anyway. */
const LOAD_ATTEMPTS = 3;

/** Whether `event` came after `position` in the same stream; another epoch is never after. */
function follows(event: StreamPosition, position: StreamPosition): boolean {
  return event.epoch === position.epoch && event.seq > position.seq;
}

/** The events of one task that arrived while one of its loads was in flight, in arrival order. */
class Recording {
  readonly events: ServiceEvent[] = [];
  /** The newest event dropped to stay within `MAX_RECORDED`. */
  dropped: StreamPosition | null = null;

  add(event: ServiceEvent) {
    const oldest = this.events.length < MAX_RECORDED ? undefined : this.events.shift();
    if (oldest) this.dropped = { epoch: oldest.epoch, seq: oldest.seq };
    this.events.push(event);
  }
}

/**
 * Applies recorded events to a task a load answered with, in order, as the stream applied them
 * to the cache; nothing is published. Returns false when one could not apply (a run or capability
 * the answer lacks, a patch that does not follow its transcript), so the answer is not current. A
 * malformed event is skipped, as the stream skips it.
 */
function replayEvents(task: CachedTask, events: readonly ServiceEvent[]): boolean {
  let current = true;
  for (const event of events) {
    try {
      if (applyEventState(task, event).kind === 'reload') current = false;
    } catch {
      // Skipped like the stream's own malformed events.
    }
  }
  return current;
}

/**
 * Keeps a task's loads in step with its stream events, which apply to the cache whether or not a
 * load is in flight. The service publishes some events after building an answer (its `epoch` and
 * `seq` say where): caching the answer as is would roll those back, and a transcript older than
 * the views' would miss the next patch's revision and load again, as old, for as long as the task
 * streams. Others it publishes before, but the stream can deliver them after the answer: applying
 * those again would roll later state back or reload a transcript that already holds them.
 */
export class TaskLoads {
  private readonly recordings = new Map<string, Set<Recording>>();
  /** Per task, the positions its cached summary and transcript were loaded at. */
  private readonly positions = new Map<
    string,
    { summary: StreamPosition; transcript: StreamPosition | null }
  >();

  /**
   * Loads a task, brings the answer up to the stream as `state`, and lets `cache` keep it. The
   * task's events that arrive meanwhile are recorded, and the ones after the answer apply to
   * `state` in order, unpublished: views applied them live or take what the caller publishes or
   * returns. Another epoch's answer (a restarted service) is kept as is. When the events cannot
   * bring the answer current (a run or capability it lacks, a patch that misses its revision,
   * events a long load dropped), the task loads again, a bounded number of times. A `state` with a
   * transcript caches the transcript too; one without keeps the cached transcript's position.
   */
  async load<T extends StreamPosition, C extends CachedTask, R>(
    taskId: string,
    request: () => Promise<T>,
    seed: (loaded: T) => C,
    cache: (loaded: T, state: C) => R,
  ): Promise<R> {
    for (let attempt = 1; ; attempt += 1) {
      const recording = this.start(taskId);
      let loaded: T;
      try {
        loaded = await request();
      } finally {
        // Synchronous from here through caching, so no event applies in between.
        this.stop(taskId, recording);
      }
      const state = seed(loaded);
      const events = recording.events.filter((event) => follows(event, loaded));
      const lost = recording.dropped !== null && follows(recording.dropped, loaded);
      const current = replayEvents(state, events) && !lost;
      if (!current && attempt < LOAD_ATTEMPTS) continue;
      const result = cache(loaded, state);
      const at = { epoch: loaded.epoch, seq: loaded.seq };
      const transcript = state.transcript ? at : (this.positions.get(taskId)?.transcript ?? null);
      this.positions.set(taskId, { summary: at, transcript });
      return result;
    }
  }

  /** Records a stream event for each load of its task in flight. */
  record(event: ServiceEvent) {
    const recordings = this.recordings.get(event.taskId);
    if (recordings) for (const recording of recordings) recording.add(event);
  }

  /** Whether the task's cached state was loaded after the service published `event`. */
  covers(event: ServiceEvent): boolean {
    const loaded = this.positions.get(event.taskId);
    const transcript = event.type === 'transcript.patch' || event.type === 'context.update';
    const at = transcript ? loaded?.transcript : loaded?.summary;
    return !!at && at.epoch === event.epoch && event.seq <= at.seq;
  }

  /**
   * The stream replaced the task's cached state (a snapshot or summaries frame), so every later
   * stream event follows it.
   */
  forget(taskId: string) {
    this.positions.delete(taskId);
  }

  clear() {
    this.positions.clear();
  }

  private start(taskId: string): Recording {
    const recording = new Recording();
    let recordings = this.recordings.get(taskId);
    if (!recordings) this.recordings.set(taskId, (recordings = new Set()));
    recordings.add(recording);
    return recording;
  }

  private stop(taskId: string, recording: Recording) {
    const recordings = this.recordings.get(taskId);
    recordings?.delete(recording);
    if (recordings?.size === 0) this.recordings.delete(taskId);
  }
}
