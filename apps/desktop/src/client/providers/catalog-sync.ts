import type { Connection } from './schema';

/** Scheduled refreshes wait this long after a success, matching Pi's remote catalog freshness window. */
export const CATALOG_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;
/**
 * How often the schedule looks for stale catalogs. Shorter than the freshness window so a
 * connection is due on the first check after its window ends, including after the machine sleeps.
 */
const CATALOG_CHECK_INTERVAL_MS = 15 * 60 * 1000;
/** An opened model list refreshes catalogs older than this, so reopening it does not refetch. */
const CATALOG_SHOWN_MAX_AGE_MS = 60 * 1000;

/**
 * Keeps saved provider catalogs current without user action: on a schedule, and whenever a model
 * list opens. A pass refreshes each connected connection whose last successful refresh is older
 * than the pass allows; failed ones stay ungated and retry on the next pass. Refreshes are
 * background refreshes, so failures stay silent.
 */
export class CatalogSync {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly syncedAt = new Map<string, number>();

  constructor(
    private readonly connections: () => readonly Connection[],
    private readonly refresh: (connectionId: string) => Promise<boolean>,
  ) {}

  /** Runs a scheduled pass now and starts the schedule; later calls only run a pass. */
  start(): void {
    void this.pass(CATALOG_SYNC_INTERVAL_MS);
    if (this.timer) return;
    this.timer = setInterval(
      () => void this.pass(CATALOG_SYNC_INTERVAL_MS),
      CATALOG_CHECK_INTERVAL_MS,
    );
    // Node timers must not keep the main process alive; browser timers are plain ids.
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  /** A model list opened: refresh what is more than a minute old so new models show while it is open. */
  shown(): void {
    void this.pass(CATALOG_SHOWN_MAX_AGE_MS);
  }

  /** Refreshes one connection now, such as after a save or sign-in, and gates later passes on success. */
  async sync(connectionId: string): Promise<boolean> {
    const synced = await this.refresh(connectionId);
    if (synced) this.syncedAt.set(connectionId, Date.now());
    return synced;
  }

  /** One pass at a time; a pass requested while another runs is dropped, not queued. */
  private async pass(maxAge: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const connection of this.connections()) {
        if (!connection.connected) continue;
        if (now - (this.syncedAt.get(connection.connectionId) ?? 0) < maxAge) continue;
        await this.sync(connection.connectionId);
      }
    } finally {
      this.running = false;
    }
  }
}
