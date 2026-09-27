import {
  getLatestCompactionEntry,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionFactory,
  type SessionManager,
} from '@earendil-works/pi-coding-agent';
import { recordCompleted, recordFailed, type RunningCompaction } from './records.js';

type CompactionEnd = Extract<AgentSessionEvent, { type: 'compaction_end' }>;

/**
 * Follows one Pi session's compactions for the transcript and context state. Pi's session events
 * give the timing: `compaction_start` comes before `session_before_compact`, so the running block
 * shows while pi-hermes-memory flushes memory in that hook, and `compaction_end` comes after Pi
 * persisted the compaction (or gave up). Its outcome is recorded next to Pi's entry
 * (records.ts); an aborted compaction (Stop, session release) leaves nothing behind.
 *
 * Attach it before the session's LiveTranscript: listeners run in subscription order, so the
 * transcript reprojects after the running state and records changed. A manual compaction becomes
 * visible when prepared, outside any session event, so `onChange` reprojects then too.
 */
export class CompactionObserver {
  private current: (RunningCompaction & { prepared: boolean }) | null = null;
  private readonly listeners = new Set<() => void>();
  private preparedWaiters: Array<() => void> = [];

  constructor(private readonly manager: SessionManager) {}

  /**
   * Marks the running compaction prepared when Pi hands it to extensions. A manual compaction
   * that ends before this point was refused (nothing to compact, no model): the caller reports
   * it and no failed block is kept. Registered before the harness, so it runs before the memory
   * flush in the same hook.
   */
  extension(): ExtensionFactory {
    return (pi) => {
      pi.on('session_before_compact', () => {
        if (this.current && !this.current.prepared) {
          this.current.prepared = true;
          if (this.current.reason === 'manual') this.changed();
        }
        const waiters = this.preparedWaiters;
        this.preparedWaiters = [];
        for (const resolve of waiters) resolve();
      });
    };
  }

  attach(session: AgentSession): void {
    session.subscribe((event) => {
      if (event.type === 'compaction_start') {
        this.current = { reason: event.reason, startedAt: Date.now(), prepared: false };
        if (event.reason !== 'manual') this.changed();
      } else if (event.type === 'compaction_end') this.end(event);
    });
  }

  /**
   * The compaction clients see running. A manual one shows only once prepared, so a refused
   * request (answered 409) never flashes a running block.
   */
  running(): RunningCompaction | null {
    const current = this.current;
    if (!current || (current.reason === 'manual' && !current.prepared)) return null;
    return { reason: current.reason, startedAt: current.startedAt };
  }

  /** Resolves once the next compaction is prepared; see `extension`. */
  nextPrepared(): Promise<void> {
    return new Promise((resolve) => this.preparedWaiters.push(resolve));
  }

  /** Called whenever `running()` changes and after each end, once the records are written. */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private end(event: CompactionEnd): void {
    const current = this.current;
    this.current = null;
    // A compaction that ended unprepared never resolves its waiters; its caller saw it end.
    this.preparedWaiters = [];
    if (event.result) {
      const entry = getLatestCompactionEntry(this.manager.getBranch());
      if (entry?.summary === event.result.summary)
        recordCompleted(this.manager, entry.id, event.reason, event.result.estimatedTokensAfter);
    } else if (
      !event.aborted &&
      event.errorMessage &&
      // Overflow recovery can give up without starting a compaction; that failure shows too.
      (event.reason !== 'manual' || current?.prepared)
    )
      recordFailed(this.manager, event.reason, event.errorMessage);
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
