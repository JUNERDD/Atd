import { SYSTEM_ACTIVITY_STALE_SECONDS } from '@atd/agent-contracts';

/**
 * How recently the person used the Mac, from the shell's reports (`POST /v1/system-activity`).
 * Only the latest report is kept, in memory: a restarted service knows nothing until the shell
 * reports again, and a report that grew stale (or a clock that went back past it) answers
 * unknown, which idle triggers read as "not idle".
 */
export class SystemActivity {
  private latest: { idleSeconds: number; receivedAt: number } | null = null;

  /** `now` is the wall clock in epoch ms; tests drive it. */
  constructor(private readonly now: () => number = Date.now) {}

  report(idleSeconds: number): void {
    this.latest = { idleSeconds, receivedAt: this.now() };
  }

  /**
   * Seconds since the person's last input at `now`: the reported idle time plus the time since
   * the report. Null without a report, or when the report is older than the stale bound.
   */
  idleSeconds(now: number = this.now()): number | null {
    if (!this.latest) return null;
    const age = (now - this.latest.receivedAt) / 1000;
    if (age < 0 || age > SYSTEM_ACTIVITY_STALE_SECONDS) return null;
    return this.latest.idleSeconds + age;
  }
}
