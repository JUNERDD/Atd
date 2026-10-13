import type { QueueState } from '@atd/agent-contracts';
import type { LiveState } from '../live-state.js';
import { HeldQueue } from './held-queue.js';
import { replaceFollowUps } from './queue-replace.js';

/** What a task's queue needs from its runner (task-runner.ts). */
export interface TaskQueueDeps {
  /** The task's live session, null while it has none. */
  live: () => LiveState | null;
  /** Whether Stop was requested for the task's current run. */
  stopped: () => boolean;
  /** Lets a steer past an approval or a question still pending (confirms.ts `interject`). */
  interject: (undelivered: () => boolean) => Promise<void>;
  /** Announces the queue a change of the held queue leaves (`queue.update`). */
  publish: (queue: QueueState) => void;
}

/**
 * The messages the user queues for a task's active run until it delivers them: on the live Pi
 * session, which delivers them into the run and publishes its queue itself (live-transcript.ts),
 * or kept out of a lite session until a full one takes them (held-queue.ts). The renderer reads
 * the result as one queue either way (`QueueState`, `queue.update`).
 */
export class TaskQueue {
  readonly held: HeldQueue;

  constructor(private readonly deps: TaskQueueDeps) {
    this.held = new HeldQueue(deps.publish);
  }

  state(): QueueState {
    return (
      this.held.state() ??
      this.deps.live()?.transcript.queueState() ?? { steering: [], followUp: [] }
    );
  }

  async add(text: string, mode: 'followUp' | 'steer'): Promise<void> {
    if (this.held.isHolding() && !this.deps.stopped()) return this.held.add(text);
    const live = this.active();
    // Pi runs skill and template expansion on every queued entry, but with no
    // skills or prompt templates loaded, `/skill:` text stays as written.
    if (mode === 'followUp') await live.session.followUp(text);
    else await live.session.steer(text);
    this.withdrawIfStopped(live);
    // A steer is sent to be read now, so it cannot wait behind an approval or a question.
    if (mode === 'steer')
      await this.deps.interject(() => live.session.getSteeringMessages().length > 0);
  }

  async replace(followUp: string[]): Promise<QueueState> {
    if (this.held.isHolding() && !this.deps.stopped()) return this.held.replace(followUp);
    const live = this.active();
    return live.transcript.batchQueue(async () => {
      const queue = await replaceFollowUps(live.session, followUp);
      this.withdrawIfStopped(live);
      return queue;
    });
  }

  /**
   * Takes everything queued back out, undelivered, for Stop to return. Pi's abort keeps its queue,
   * and the next prompt would deliver it into an unrelated run, so Stop withdraws it first, as Pi's
   * own Stop restores it to the editor. Held messages follow what a full session already took over.
   */
  withdraw(): QueueState {
    const queued = this.deps.live()?.session.clearQueue() ?? { steering: [], followUp: [] };
    return { ...queued, followUp: [...queued.followUp, ...this.held.withdraw()] };
  }

  private active(): LiveState {
    const live = this.deps.live();
    if (!live || this.deps.stopped()) throw new Error('The task has no active run.');
    return live;
  }

  /**
   * Stop withdraws the queue once, but an edit that was still validating or in
   * Pi's input handlers lands afterwards; take it back out so it cannot reach
   * a later run, and fail so the caller keeps its text.
   */
  private withdrawIfStopped(live: LiveState): void {
    if (!this.deps.stopped()) return;
    live.session.clearQueue();
    throw new Error('The task stopped before the message was queued.');
  }
}
