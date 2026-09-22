import type { ServiceConnection } from './connection';
import { startLocalService } from './launcher';

/**
 * Bring the local service up before the renderer: connect to a live process
 * in dataDir, else spawn one and connect. Never rejects — failure stays on
 * the connection as disconnected + message for the banner and settings.
 */
export async function autostartService(
  connection: ServiceConnection,
  opts: { dataDir: string; onLive: (live: boolean) => void },
): Promise<void> {
  try {
    await connection.connect(opts.dataDir, { quiet: true });
    opts.onLive(true);
    return;
  } catch {
    // No live service in this dataDir; try spawning one below.
  }
  try {
    await startLocalService({ dataDir: opts.dataDir });
    await connection.connect(opts.dataDir);
    opts.onLive(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent service did not start.';
    connection.fail(message);
  }
}
