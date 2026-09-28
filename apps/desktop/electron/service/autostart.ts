import { app } from 'electron';
import type { ServiceConnection } from './connection';
import { discoverService, type ServiceEndpoint } from './endpoint';
import { stopLocalService } from './launcher';
import { isRunningServiceCurrent, readBundledBuildId } from './service-code';
import type { ServiceSupervisor } from './supervisor';

/**
 * Bring the local service up before the renderer. A process already bound to this dataDir is
 * reused only while it runs the current code, and otherwise replaced, so a launch never
 * reconnects to a stale build. Reuse matters because a crash or a force quit (SIGKILL) leaves the
 * service running, as does starting one by hand; a normal quit and the dev restart's SIGTERM both
 * reach before-quit and stop it. Never rejects — failure stays on the connection as disconnected
 * + message for the banner and settings.
 */
export async function autostartService(
  connection: ServiceConnection,
  opts: {
    dataDir: string;
    onLive: (live: boolean) => void;
    supervisor: Pick<ServiceSupervisor, 'adopt' | 'start'>;
  },
): Promise<void> {
  // Runs synchronously before the first window loads, so the renderer's
  // initial status() sees connecting instead of a transient disconnected.
  connection.markStarting();
  const adopted = await reuseCurrentService(connection, opts.dataDir);
  if (adopted !== null) {
    opts.onLive(true);
    opts.supervisor.adopt(adopted);
    return;
  }
  // Nothing is supervised yet, so replacing a stale process never counts as a crash.
  await stopLocalService(opts.dataDir);
  // Covers the stop/spawn gap after a quiet probe failure.
  connection.markStarting('Starting the local agent service…');
  await opts.supervisor.start();
}

/**
 * Connects to a running service that runs the current code and returns its pid. Restarting is
 * always the safe answer, so a missing or stale endpoint, a failed comparison and a failed
 * connect all return null and leave the caller on the stop-and-spawn path.
 */
async function reuseCurrentService(
  connection: ServiceConnection,
  dataDir: string,
): Promise<number | null> {
  try {
    const endpoint = await discoverService(dataDir);
    if (!(await runsCurrentCode(endpoint))) return null;
    // Quiet: a failure keeps the banner on connecting while the caller replaces the process.
    await connection.connect(dataDir, { quiet: true });
    return endpoint.pid;
  } catch {
    return null;
  }
}

/**
 * Packaged: the endpoint's build id must equal the bundled service's; a missing id on either
 * side never matches. Unpackaged: the process must be newer than the code it would run now, and
 * AI_AGENT_FORCE_RESTART skips the probe outright.
 */
async function runsCurrentCode(endpoint: ServiceEndpoint): Promise<boolean> {
  if (app.isPackaged) {
    const bundled = await readBundledBuildId();
    return bundled !== null && endpoint.buildId === bundled;
  }
  if (process.env.AI_AGENT_FORCE_RESTART?.trim()) return false;
  return isRunningServiceCurrent(endpoint.startedAt);
}
