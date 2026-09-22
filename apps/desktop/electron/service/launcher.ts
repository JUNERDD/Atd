import { spawn } from 'node:child_process';
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverService } from './endpoint';
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
  const cli = await resolveServiceCli();
  const node = await resolveSystemNode(await readEnginesFromCli(cli));
  const args = ['serve', '--dataDir', path.resolve(options.dataDir)];
  if (options.host) args.push('--host', options.host);
  if (options.port !== undefined) args.push('--port', String(options.port));
  const child = spawn(node, [cli, ...args], {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, PATH: nodeSearchPath() },
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
  if (await waitForExit(dataDir, pid, 20000)) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  await waitForExit(dataDir, pid, 5000);
}

async function waitForExit(dataDir: string, pid: number, timeoutMs: number): Promise<boolean> {
  const file = path.join(path.resolve(dataDir), 'endpoint.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    try {
      await readFile(file, 'utf8');
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function resolveServiceCli(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // Packaged extraResources: <Resources>/agent-service/dist/cli.js
    path.join(process.resourcesPath, 'agent-service/dist/cli.js'),
    // Packaged via app path: <app.asar>/../agent-service/dist/cli.js
    path.resolve(app.getAppPath(), '../agent-service/dist/cli.js'),
    // Built main: apps/desktop/dist-electron -> apps/agent-service.
    path.resolve(here, '../../agent-service/dist/cli.js'),
    // Dev source: apps/desktop/electron/service -> apps/agent-service.
    path.resolve(here, '../../../agent-service/dist/cli.js'),
  ];
  for (const file of candidates) {
    try {
      await readFile(file, 'utf8');
      return file;
    } catch {
      // Try the next layout.
    }
  }
  throw new Error(
    'The agent service is not built. Run `pnpm --filter @ai/agent-service build`, then try again.',
  );
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
