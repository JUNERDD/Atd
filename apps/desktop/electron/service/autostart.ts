import { app } from 'electron';
import type { ServiceConnection } from './connection';
import { startLocalService, stopLocalService } from './launcher';

/**
 * Bring the local service up before the renderer. Unpackaged starts replace
 * any process already bound to this dataDir, so the next launch runs the
 * current service source instead of reconnecting to a stale build. Packaged
 * starts reuse a live process. Never rejects — failure stays on the
 * connection as disconnected + message for the banner and settings.
 */
export async function autostartService(
  connection: ServiceConnection,
  opts: { dataDir: string; onLive: (live: boolean) => void },
): Promise<void> {
  // Runs synchronously before the first window loads, so the renderer's
  // initial status() sees connecting instead of a transient disconnected.
  connection.markStarting();
  if (!app.isPackaged) {
    await stopLocalService(opts.dataDir);
    await spawnAndConnect(connection, opts);
    return;
  }
  try {
    await connection.connect(opts.dataDir, { quiet: true });
    opts.onLive(true);
  } catch {
    await spawnAndConnect(connection, opts);
  }
}

async function spawnAndConnect(
  connection: ServiceConnection,
  opts: { dataDir: string; onLive: (live: boolean) => void },
): Promise<void> {
  try {
    // Covers the stop/spawn gap after a quiet probe failure.
    connection.markStarting('Starting the local agent service…');
    await startLocalService({ dataDir: opts.dataDir });
    await connection.connect(opts.dataDir);
    opts.onLive(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent service did not start.';
    connection.fail(message);
  }
}
