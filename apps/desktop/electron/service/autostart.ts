import { app } from 'electron';
import type { ServiceConnection } from './connection';
import { discoverService } from './endpoint';
import { isRunningServiceCurrent, startLocalService, stopLocalService } from './launcher';

/**
 * Bring the local service up before the renderer. Unpackaged starts reuse a
 * process already bound to this dataDir only while it is newer than the code
 * it runs, and otherwise replace it, so a launch never reconnects to a stale
 * build. Reuse matters because a crash or a force quit (SIGKILL) leaves the
 * service running, as does starting one by hand; a normal quit and the dev
 * restart's SIGTERM both reach before-quit and stop it. Packaged starts reuse
 * a live process. Never rejects — failure stays on the connection as
 * disconnected + message for the banner and settings.
 */
export async function autostartService(
  connection: ServiceConnection,
  opts: { dataDir: string; onLive: (live: boolean) => void },
): Promise<void> {
  // Runs synchronously before the first window loads, so the renderer's
  // initial status() sees connecting instead of a transient disconnected.
  connection.markStarting();
  if (!app.isPackaged) {
    if (await reuseCurrentService(connection, opts)) return;
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

/**
 * Adopts a running service and reports whether it was adopted. Restarting is
 * always the safe answer, so a missing or stale endpoint, a failed freshness
 * comparison and a failed connect all return false and leave the caller on
 * the stop-and-spawn path. AI_AGENT_FORCE_RESTART skips the probe outright.
 */
async function reuseCurrentService(
  connection: ServiceConnection,
  opts: { dataDir: string; onLive: (live: boolean) => void },
): Promise<boolean> {
  if (process.env.AI_AGENT_FORCE_RESTART?.trim()) return false;
  try {
    const endpoint = await discoverService(opts.dataDir);
    if (!(await isRunningServiceCurrent(endpoint.startedAt))) return false;
    await connection.connect(opts.dataDir);
    opts.onLive(true);
    return true;
  } catch {
    return false;
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
