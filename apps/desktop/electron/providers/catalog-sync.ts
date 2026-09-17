import type { StoredConnection } from './schema';

/** Re-check stale catalogs on this cadence, matching the SDK's remote catalog freshness window. */
export const CATALOG_SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Keeps saved provider catalogs current without user action. A successful refresh
 * waits one interval; failed ones stay ungated and retry on the next pass.
 */
export class CatalogSync {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly syncedAt = new Map<string, number>();
  constructor(
    private readonly connections: () => readonly StoredConnection[],
    private readonly sync: (connectionId: string) => Promise<boolean>,
  ) {}
  start() {
    if (this.timer) return;
    void this.pass();
    this.timer = setInterval(() => void this.pass(), CATALOG_SYNC_INTERVAL_MS);
    this.timer.unref();
  }
  private async pass() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      for (const connection of this.connections()) {
        if (!connection.connected) continue;
        if (now - (this.syncedAt.get(connection.connectionId) ?? 0) < CATALOG_SYNC_INTERVAL_MS)
          continue;
        if (await this.sync(connection.connectionId))
          this.syncedAt.set(connection.connectionId, Date.now());
      }
    } catch {
      // Transient failures retry on the next pass.
    } finally {
      this.running = false;
    }
  }
}
