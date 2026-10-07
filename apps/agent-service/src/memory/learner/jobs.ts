import { errorMessage } from '@atd/agent-contracts';
import type { Logger } from '../../logging.js';
import type { LearnerRequest } from './triggers.js';

/**
 * Runs one review and resolves when it ends. Its synchronous part runs when the review starts
 * (the learner restarts its trigger counts there), so it must not call back into `LearnerJobs`.
 */
export type LearnerRun = (request: LearnerRequest, signal: AbortSignal) => Promise<void>;

/**
 * One memory review per task session at a time (decision R5). A request while a review runs is
 * dropped, since its trigger comes round again, except a correction: the running review may have
 * read the conversation before it, so it waits in a single slot and runs next. `close` gives the
 * running and waiting reviews until a cap, then aborts them, and `abort` aborts them at once, so
 * none outlives its session.
 */
export class LearnerJobs {
  private running: Promise<void> | null = null;
  private waiting: LearnerRequest | null = null;
  private closed = false;
  private readonly controller = new AbortController();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly run: LearnerRun,
    private readonly log: Logger,
  ) {}

  request(request: LearnerRequest): void {
    if (this.closed) return;
    if (!this.running) this.start(request);
    else if (request.trigger === 'correction') this.waiting = request;
  }

  /**
   * Stops taking requests, runs `last` after the running review unless a waiting one covers it,
   * and waits up to `capMs` for them before aborting. Resolves once no review runs.
   */
  async close(last: LearnerRequest | null, capMs: number): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      if (last && !this.running) this.start(last);
      else if (last) this.waiting ??= last;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, capMs);
      });
      await Promise.race([this.idle(), cap]);
      clearTimeout(timer);
      this.waiting = null;
      this.controller.abort();
    }
    await this.idle();
  }

  /**
   * Stops taking requests, drops the waiting review and aborts the running one now. Resolves once
   * no review runs.
   */
  async abort(): Promise<void> {
    this.closed = true;
    this.waiting = null;
    this.controller.abort();
    await this.idle();
  }

  private start(request: LearnerRequest): void {
    this.running = this.run(request, this.controller.signal)
      .catch((error: unknown) => {
        this.log.warn('A memory review failed unexpectedly.', {
          trigger: request.trigger,
          error: errorMessage(error),
        });
      })
      .finally(() => {
        const next = this.controller.signal.aborted ? null : this.waiting;
        this.waiting = null;
        if (next) {
          this.start(next);
          return;
        }
        this.running = null;
        for (const resolve of this.idleWaiters.splice(0)) resolve();
      });
  }

  private idle(): Promise<void> {
    if (!this.running) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}
