import { spawn } from 'node:child_process';
import { app } from 'electron';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { discoverService, resolveServiceAtdHome } from './endpoint';
import { nodeSearchPath, readEnginesFromCli, resolveSystemNode } from './node-runtime';

/**
 * Starts a local agent service as a child of Electron (not detached). App
 * quit stops it via stopLocalService; a crash also takes the child with it.
 * Spawns system Node (version-checked against service engines).
 */
export async function startLocalService(options: {
  dataDir: string;
  host?: string;
  port?: number;
}): Promise<{ pid: number; dataDir: string }> {
  const command = await resolveServiceCommand();
  const node = await resolveSystemNode(await readEnginesFromCli(command.script));
  const args = ['serve', '--dataDir', path.resolve(options.dataDir), '--web-root', webRoot()];
  if (options.host) args.push('--host', options.host);
  if (options.port !== undefined) args.push('--port', String(options.port));
  const atdHome = resolveServiceAtdHome();
  const child = spawn(node, [...command.nodeArgs, command.script, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: {
      ...process.env,
      PATH: nodeSearchPath(),
      ...(atdHome !== null ? { AI_ATD_HOME: atdHome } : {}),
    },
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', (error) => reject(new Error(`Could not start Node: ${error.message}`)));
    child.once('spawn', () => resolve());
  });
  if (!child.pid) throw new Error('The service process could not be started.');
  const pid = child.pid;
  let settled = false;
  const exited = new Promise<never>((_resolve, reject) => {
    child.once('exit', (code) => {
      if (settled) return;
      reject(new Error(serviceExitMessage(stderr, code)));
    });
  });
  try {
    await Promise.race([
      waitForEndpoint(options.dataDir, 15000).then(() => {
        settled = true;
      }),
      exited,
    ]);
  } catch (error) {
    settled = true;
    if (child.exitCode === null && !child.killed) child.kill('SIGTERM');
    throw error;
  }
  return { pid, dataDir: path.resolve(options.dataDir) };
}

function serviceExitMessage(stderr: string, code: number | null): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const syntax = lines.find((line) => line.startsWith('SyntaxError:') || line.startsWith('Error:'));
  if (syntax) return syntax.slice(0, 500);
  const tail = lines.slice(-4).join(' ');
  return (tail || `The agent service exited with code ${code ?? 1}.`).slice(0, 500);
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

interface ServiceCommand {
  /** Loader flags that precede the script. Empty when the script is compiled. */
  nodeArgs: string[];
  /** CLI path. Engines are read from the package.json beside this file. */
  script: string;
}

/**
 * Unpackaged launches prefer the built `dist/cli.js` when it is newer than
 * every service source file (about 2.6s vs 5.4s cold start); a stale dist
 * falls back to `src/cli.ts` through jiti, so a restart always executes the
 * current service source. Packaged launches keep the bundled dist.
 */
async function resolveServiceCommand(): Promise<ServiceCommand> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  if (!app.isPackaged) {
    const source = await firstReadable(sourceCliCandidates(here));
    const dist = await firstReadable(distCliCandidates(here));
    if (dist && source && (await isDistFresh(dist, path.dirname(source)))) {
      return { nodeArgs: [], script: dist };
    }
    if (source) {
      const register = path.resolve(
        path.dirname(source),
        '../node_modules/jiti/lib/jiti-register.mjs',
      );
      if (!(await isReadable(register))) {
        if (dist) return { nodeArgs: [], script: dist };
        throw new Error(
          'The agent service source is present, but its TypeScript loader (jiti) is not installed. Run pnpm install, then start again.',
        );
      }
      return { nodeArgs: ['--import', pathToFileURL(register).href], script: source };
    }
  }
  const dist = await firstReadable(distCliCandidates(here));
  if (dist) return { nodeArgs: [], script: dist };
  throw new Error(
    'The agent service is not built. Run `pnpm --filter @ai/agent-service build`, then try again.',
  );
}

/**
 * True when the build is newer than every `.ts` source file. The comparison
 * takes the newest file anywhere in `dist`, not the CLI alone: the dev watcher
 * compiles incrementally, so editing one module rewrites only that module's
 * output and leaves `cli.js` at the time of the last full build. tsc writes
 * its build-info file after the emit, so a dist that is newer than every
 * source also means the compile finished. A read failure returns false (run
 * current source); workspace dependencies still require `pnpm build`, as in
 * both launch paths.
 */
async function isDistFresh(distFile: string, srcDir: string): Promise<boolean> {
  const newestSrc = await newestMtimeMs(srcDir, '.ts');
  if (newestSrc === null) return false;
  const newestDist = await newestMtimeMs(path.dirname(distFile));
  return newestDist !== null && newestSrc <= newestDist;
}

/**
 * True when a service that started at `startedAt` (ISO, from its endpoint
 * file) still runs the current code: its own sources, the build the launcher
 * would execute, and the sources of the workspace packages it is compiled
 * against must all predate the process. Unpackaged callers only. Every
 * unknown answer — absent input, unreadable entry, unparseable timestamp —
 * is false, so a caller respawns instead of reusing possibly stale code.
 */
export async function isRunningServiceCurrent(startedAt: string): Promise<boolean> {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return false;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = await firstReadable(sourceCliCandidates(here));
  const dist = await firstReadable(distCliCandidates(here));
  if (!source || !dist) return false;
  const workspaceDirs = await workspaceSourceDirs(path.resolve(path.dirname(source), '..'));
  if (!workspaceDirs) return false;
  // dist counts too: a rebuild after the process started means the live
  // process is running the previous build.
  for (const dir of [path.dirname(source), path.dirname(dist), ...workspaceDirs]) {
    const newest = await newestMtimeMs(dir);
    if (newest === null || newest > started) return false;
  }
  return true;
}

/**
 * `src` directories of the workspace packages the service imports at runtime,
 * read from its own manifest so a new workspace dependency is covered without
 * editing this file, and resolved through the links pnpm writes into the
 * service's node_modules. devDependencies stay out: they are build config,
 * not code the service loads. Null when the manifest cannot be read.
 */
async function workspaceSourceDirs(serviceRoot: string): Promise<string[] | null> {
  let manifest: { dependencies?: Record<string, unknown> };
  try {
    manifest = JSON.parse(await readFile(path.join(serviceRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>;
    };
  } catch {
    return null;
  }
  return Object.entries(manifest.dependencies ?? {})
    .filter(([, range]) => typeof range === 'string' && range.startsWith('workspace:'))
    .map(([name]) => path.join(serviceRoot, 'node_modules', name, 'src'));
}

/**
 * Newest file mtime under `dir` in ms, walking subdirectories but never
 * node_modules; `ext` limits which files count. Returns null when any entry
 * cannot be read, so callers can tell "nothing changed" apart from "cannot
 * tell" instead of reading an unreadable tree as unchanged.
 */
async function newestMtimeMs(dir: string, ext?: string): Promise<number | null> {
  let newest = 0;
  const pending: string[] = [dir];
  while (pending.length) {
    const current = pending.pop() as string;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') pending.push(full);
        continue;
      }
      if (ext !== undefined && !entry.name.endsWith(ext)) continue;
      try {
        const mtime = (await stat(full)).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        return null;
      }
    }
  }
  return newest;
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

function sourceCliCandidates(here: string): string[] {
  return [
    path.resolve(here, '../../agent-service/src/cli.ts'),
    path.resolve(here, '../../../agent-service/src/cli.ts'),
  ];
}

function distCliCandidates(here: string): string[] {
  return [
    path.join(process.resourcesPath, 'agent-service/dist/cli.js'),
    path.resolve(app.getAppPath(), '../agent-service/dist/cli.js'),
    path.resolve(here, '../../agent-service/dist/cli.js'),
    path.resolve(here, '../../../agent-service/dist/cli.js'),
  ];
}

async function firstReadable(candidates: string[]): Promise<string | null> {
  for (const file of candidates) {
    if (await isReadable(file)) return file;
  }
  return null;
}

async function isReadable(file: string): Promise<boolean> {
  try {
    await readFile(file, 'utf8');
    return true;
  } catch {
    return false;
  }
}

async function waitForEndpoint(dataDir: string, timeoutMs: number): Promise<void> {
  const file = path.join(path.resolve(dataDir), 'endpoint.json');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const raw = JSON.parse(await readFile(file, 'utf8')) as { url?: unknown; pid?: unknown };
      if (typeof raw.url === 'string' && raw.url && typeof raw.pid === 'number') {
        try {
          process.kill(raw.pid, 0);
          return;
        } catch {
          // The endpoint is stale; keep waiting for a live one.
        }
      }
    } catch {
      // Not ready yet.
    }
    if (Date.now() > deadline) throw new Error('The service did not publish its endpoint in time.');
    // This poll sits on the launch path the connecting banner waits for, so the
    // step stays well under the endpoint write it is watching for.
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
