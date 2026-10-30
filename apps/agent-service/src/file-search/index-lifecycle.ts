import type { Logger } from '../logging.js';

/** Waits between consecutive failed opens; the last one repeats until an open succeeds. */
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 60_000];
/** How long shutdown waits, in all, for a pending open and then for the index to close. */
const CLOSE_TIMEOUT_MS = 5000;

/**
 * Why an open failed, in words that carry no path: native messages can name files, so only a
 * category of them is kept. A permanent failure (the addon cannot load on this system) is not
 * retried.
 */
export interface OpenFailure {
  stage: 'load' | 'open' | 'start';
  cause: string;
  permanent: boolean;
}

/** An open that failed for `failure`; anything else an opener throws counts as `unknown`. */
export class OpenFailed extends Error {
  override name = 'OpenFailed';
  constructor(readonly failure: OpenFailure) {
    super(`The file index could not ${failure.stage}: ${failure.cause}.`);
  }
}

/** What a search sees of the index's life. */
export type IndexSlot<T> =
  | { kind: 'idle' }
  | { kind: 'opening'; ready: Promise<T | null> }
  | { kind: 'open'; index: T }
  | { kind: 'retrying' }
  | { kind: 'unsupported' }
  | { kind: 'closed' };

/**
 * Opens the index once, on the first search or a warm start, and keeps it until shutdown. A
 * failed open is retried with backoff, never cached for the life of the process: a restart that
 * overlaps the previous service, which still holds the index's lock while it saves, recovers on
 * its own. Each new failure cause is logged once, as a category.
 */
export class IndexLifecycle<T extends { close(): Promise<void> }> {
  private slot: IndexSlot<T> = { kind: 'idle' };
  private failures = 0;
  private reported: string | null = null;
  private retry: NodeJS.Timeout | null = null;

  constructor(
    private readonly open: () => Promise<T>,
    private readonly log: Logger,
  ) {}

  /** The index's state, starting the first open when none ran yet. */
  current(): IndexSlot<T> {
    if (this.slot.kind === 'idle') this.begin();
    return this.slot;
  }

  /** Starts the first open unless an open already ran or runs. */
  start(): void {
    if (this.slot.kind === 'idle') this.begin();
  }

  /**
   * Stops retrying and closes the index. An open still running is awaited within the same
   * deadline as the close; one that outlasts it is closed whenever it lands, so its lock and
   * resume point are still released.
   */
  async close(): Promise<void> {
    const slot = this.slot;
    if (slot.kind === 'closed') return;
    this.slot = { kind: 'closed' };
    if (this.retry) clearTimeout(this.retry);
    const pending = slot.kind === 'open' ? slot.index : slot.kind === 'opening' ? slot.ready : null;
    if (!pending) return;
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), CLOSE_TIMEOUT_MS).unref();
    });
    try {
      const index = await Promise.race([pending, deadline]);
      if (index === 'late') {
        void Promise.resolve(pending).then((late) => late?.close().catch(() => undefined));
        return;
      }
      if (index) await Promise.race([index.close().catch(() => undefined), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private begin(): void {
    this.slot = { kind: 'opening', ready: this.attempt() };
  }

  /** One open; resolves the index, or null once the failure is recorded and a retry planned. */
  private async attempt(): Promise<T | null> {
    try {
      const index = await this.open();
      // Shutdown began meanwhile: `close` takes the index from `ready` and closes it.
      if (this.slot.kind === 'closed') return index;
      if (this.failures > 0)
        this.log.info('The file index opened after retrying.', { attempts: this.failures + 1 });
      this.failures = 0;
      this.reported = null;
      this.slot = { kind: 'open', index };
      return index;
    } catch (error) {
      if (this.slot.kind !== 'closed') this.failed(failureOf(error));
      return null;
    }
  }

  private failed(failure: OpenFailure): void {
    this.failures += 1;
    if (failure.permanent) {
      this.log.warn('File search is unavailable: its index cannot load here.', { ...failure });
      this.slot = { kind: 'unsupported' };
      return;
    }
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1] ?? 0;
    const cause = `${failure.stage}:${failure.cause}`;
    if (cause !== this.reported) {
      this.reported = cause;
      this.log.warn('The file index could not open; retrying.', {
        stage: failure.stage,
        cause: failure.cause,
        attempt: this.failures,
        retryInMs: delay,
      });
    }
    this.slot = { kind: 'retrying' };
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.slot.kind === 'retrying') this.begin();
    }, delay).unref();
  }
}

function failureOf(error: unknown): OpenFailure {
  return error instanceof OpenFailed
    ? error.failure
    : { stage: 'open', cause: 'unknown', permanent: false };
}
