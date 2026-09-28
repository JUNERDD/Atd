import { spawn, type ChildProcess } from 'node:child_process';
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverService, resolveServiceAtdHome } from './endpoint';
import { nodeSearchPath, readEnginesFromCli, resolveServiceNode } from './node-runtime';
import { resolveServiceCommand } from './service-code';
import { openServiceLog, startupFailureMessage } from './service-log';
import { loginShellPath } from './shell-path';

/** How a spawned service process ended: an exit code, or the signal that stopped it. */
export interface ServiceExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

/** A service this process spawned and saw publish its endpoint. */
export interface LocalService {
  pid: number;
  dataDir: string;
  /**
   * Settles once the process exits, for whatever reason. Callers decide whether an exit was
   * expected; the launcher cannot tell a crash from a requested shutdown.
   */
  exited: Promise<ServiceExit>;
}

/**
 * Starts a local agent service as a child of Electron (not detached) and resolves once it has
 * published a live endpoint. Its stdout and stderr go to `<dataDir>/logs/service.log`, never to
 * a pipe, so the process does not depend on Electron staying alive. App quit stops it via
 * stopLocalService. Packaged builds run the bundled Node; unpackaged builds run the system Node,
 * version-checked against the service engines. The child's PATH starts from the user's
 * login-shell PATH (`shell-path.ts`), resolved once per app run.
 */
export async function startLocalService(options: {
  dataDir: string;
  host?: string;
  port?: number;
}): Promise<LocalService> {
  const dataDir = path.resolve(options.dataDir);
  const command = await resolveServiceCommand();
  const searchPath = nodeSearchPath(await loginShellPath());
  const node = await resolveServiceNode(
    await readEnginesFromCli(command.script),
    app.isPackaged ? path.join(process.resourcesPath, 'node') : null,
    searchPath,
  );
  const args = ['serve', '--dataDir', dataDir, '--web-root', webRoot()];
  if (options.host) args.push('--host', options.host);
  if (options.port !== undefined) args.push('--port', String(options.port));
  const atdHome = resolveServiceAtdHome();
  const log = await openServiceLog(dataDir);
  let child: ChildProcess;
  let exited: Promise<ServiceExit>;
  try {
    child = spawn(node.command, [...command.nodeArgs, command.script, ...args], {
      stdio: ['ignore', log.handle.fd, log.handle.fd],
      env: {
        ...process.env,
        // Everything the agent runs inherits this PATH. The user's toolchain comes first, so
        // `node` and `npm` in their projects are one matching pair; the bundled Node is the
        // last-resort `node` for users without one. The service itself and pi-subagents' child
        // runs use the bundled binary by absolute path (`process.execPath`), whatever PATH says.
        PATH: node.binDir !== null ? [searchPath, node.binDir].join(path.delimiter) : searchPath,
        ...(atdHome !== null ? { AI_ATD_HOME: atdHome } : {}),
      },
    });
    // Listen before any await: a child that dies at once must still settle `exited`.
    exited = new Promise<ServiceExit>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    await new Promise<void>((resolve, reject) => {
      child.once('error', (error) => reject(new Error(`Could not start Node: ${error.message}`)));
      child.once('spawn', () => resolve());
    });
  } finally {
    // The child holds its own copy of the descriptor from spawn on.
    await log.handle.close();
  }
  if (!child.pid) throw new Error('The service process could not be started.');
  const pid = child.pid;
  const running = () => child.exitCode === null && child.signalCode === null;
  try {
    await waitForEndpoint(dataDir, pid, 15000, running);
  } catch (error) {
    if (running()) {
      if (!child.killed) child.kill('SIGTERM');
      throw error;
    }
    // `exit` has already fired when exitCode is set, so this settles at once.
    throw new Error(await startupFailureMessage(log, await exited));
  }
  return { pid, dataDir, exited };
}

/** Asks the service to shut down, then waits for the process to exit. */
export async function stopLocalService(dataDir: string): Promise<void> {
  let pid: number;
  let baseUrl: string;
  let token: string;
  try {
    const endpoint = await discoverService(dataDir);
    pid = endpoint.pid;
    baseUrl = endpoint.baseUrl;
    token = endpoint.token;
  } catch {
    return;
  }
  try {
    await fetch(`${baseUrl}/v1/admin/shutdown`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }
  if (await waitForExit(pid, 20000)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitForExit(pid, 5000);
}

/**
 * Polls the process itself. The service removes endpoint.json before it
 * exits, so a missing file cannot tell a finished shutdown from one that
 * stopped listening but never exited; only the SIGTERM fallback ends that.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    // A graceful shutdown takes about 30ms, so poll far below the old 250ms
    // step: the restart path waits on this before it can spawn again.
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * The web client build the service serves at `/`: bundled next to the service in a packaged app,
 * `dist-web` (`pnpm --filter @ai/desktop build:web`) otherwise. A missing build leaves the
 * service API-only; it says so on `/`.
 */
function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(app.getAppPath(), 'dist-web');
}

/**
 * Polls until the spawned process (`pid`) publishes its endpoint. Another live service's endpoint
 * does not count: this child then fails on the dataDir lock and reports that. Stops as soon as
 * `running` turns false, so a service that exits at startup reports its own error instead of
 * waiting out the timeout.
 */
async function waitForEndpoint(
  dataDir: string,
  pid: number,
  timeoutMs: number,
  running: () => boolean,
): Promise<void> {
  const file = path.join(dataDir, 'endpoint.json');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!running()) throw new Error('The service exited during startup.');
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { url?: unknown; pid?: unknown };
      if (typeof raw.url === 'string' && raw.url && raw.pid === pid) return;
    } catch {
      // Not ready yet.
    }
    if (Date.now() > deadline) throw new Error('The service did not publish its endpoint in time.');
    // This poll sits on the launch path the connecting banner waits for, so the
    // step stays well under the endpoint write it is watching for.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
