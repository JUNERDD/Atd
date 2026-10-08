#!/usr/bin/env node
/**
 * Agent service CLI: foreground `serve`, plus `status` and `stop` against the
 * dataDir endpoint file.
 */
import path from 'node:path';
import { errorMessage } from '@atd/agent-contracts';
import { approveMcp } from './cli-approve.js';
import { prepareServe, readEndpoint, readLocalToken, releaseLock } from './config.js';
import { createService } from './index.js';
import { createLogger } from './logging.js';
import { applyLoginShellPath } from './login-shell-path.js';
import { assertSupportedNode, readServiceManifest } from './node-runtime.js';
import { resolveAtdHome, resolveDataDir } from './storage.js';

const RENDERER_PORT = 5173;

interface Flags {
  dataDir?: string;
  host?: string;
  port?: number;
  tier?: 'manual' | 'auto' | 'always';
  loginShellPath?: boolean;
  yes?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    // The value of a valued flag; a flag missing its value falls through to "Unknown argument".
    const value = argv[index + 1];
    if (arg === '--login-shell-path') flags.loginShellPath = true;
    else if (arg === '--yes') flags.yes = true;
    else if (!value) throw new Error(`Unknown argument: ${arg}`);
    else {
      index += 1;
      if (arg === '--dataDir') flags.dataDir = value;
      else if (arg === '--host') flags.host = value;
      else if (arg === '--port') flags.port = Number(value);
      else if (arg === '--tier') {
        if (value !== 'manual' && value !== 'auto' && value !== 'always')
          throw new Error('--tier must be manual, auto or always.');
        flags.tier = value;
      } else throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return flags;
}

function usage(): string {
  const { version, engines } = readServiceManifest();
  return [
    `agent-service ${version}`,
    '',
    'Usage: node dist/cli.js <command> [flags]',
    '',
    '  serve [--dataDir <dir>] [--host 127.0.0.1] [--port 0] [--tier manual] [--login-shell-path]',
    '  status [--dataDir <dir>]',
    '  stop [--dataDir <dir>]',
    '  approve mcp <serverId> [--dataDir <dir>] [--yes]',
    '',
    '  --help, -h       Show this help',
    '  --version, -v    Print version and Node requirement',
    '',
    `Requires Node.js ${engines} on PATH (workspace toolchain; covers Pi 1.0.0`,
    '≥22.19.0); there is no auto-download.',
    'AI_AGENT_DATA_DIR overrides --dataDir.',
    'approve asks the running service what an MCP server would launch and approves it after a',
    'y on the terminal; without a terminal it refuses unless --yes is given.',
    '--login-shell-path makes serve adopt the login shell PATH before it starts',
    '(for launchers with a minimal GUI PATH; off by default).',
    'Default host is loopback; --port 0',
    'lets the OS assign a port (never 5173). Runs without a saved provider',
    'connection use AI_AGENT_TEMP_API_KEY (+PROVIDER/MODEL/BASE_URL), never stored.',
  ].join('\n');
}

async function serve(flags: Flags): Promise<void> {
  const log = createLogger(process.env.AI_AGENT_LOG_LEVEL === 'debug' ? 'debug' : 'info');
  if (flags.port === RENDERER_PORT)
    throw new Error('Port 5173 belongs to the renderer preview; choose another port.');
  if (
    flags.host &&
    flags.host !== '127.0.0.1' &&
    flags.host !== '::1' &&
    flags.host !== 'localhost'
  )
    throw new Error('Only loopback hosts are supported in T1.');
  // Before anything reads PATH: MCP stdio servers, ripgrep and tool runs use process.env.PATH.
  if (flags.loginShellPath) await applyLoginShellPath(log);
  const config = await prepareServe({
    envDir: process.env.AI_AGENT_DATA_DIR,
    flagDir: flags.dataDir,
    host: flags.host,
    port: flags.port,
  });
  // `atdHome()` reads this on every call, and the processes the service starts inherit it.
  process.env.AI_ATD_HOME = resolveAtdHome({
    envHome: process.env.AI_ATD_HOME,
    dataDir: config.paths.root,
  });
  // SIGINT, SIGTERM and `POST /v1/admin/shutdown` all end here. The exit is
  // what ends the process once the service has stopped; nothing else would.
  // Exit joins libuv's thread pool, so a pool thread stuck in a blocking call
  // holds the process past "stopped"; the supervisor kills it then.
  const shutdown = (trigger = 'shutdown request') => {
    const started = performance.now();
    log.info('Stopping the agent service.', { trigger });
    void handle
      .stop()
      .then(() => {
        log.info('Agent service stopped.', { elapsedMs: Math.round(performance.now() - started) });
        process.exit(0);
      })
      .catch((error: unknown) => {
        log.error('Shutdown failed.', { error: errorMessage(error) });
        process.exit(1);
      });
  };
  const handle = await createService(config, { tier: flags.tier, onShutdownRequest: shutdown });
  const { url, port } = await handle.start();
  log.info('Agent service ready.', {
    serviceId: config.serviceId,
    epoch: config.epoch,
    port,
    dataDir: config.paths.root,
    atdHome: process.env.AI_ATD_HOME,
    recovery: handle.report,
  });
  // Machine-readable readiness line for supervisors and the T1 proof harness.
  process.stdout.write(
    `AGENT_SERVICE_READY url=${url} serviceId=${config.serviceId} epoch=${config.epoch}\n`,
  );
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise(() => undefined);
}

function locate(flags: Flags): string {
  return resolveDataDir({ envDir: process.env.AI_AGENT_DATA_DIR, flagDir: flags.dataDir });
}

async function status(flags: Flags): Promise<void> {
  const dataDir = path.resolve(locate(flags));
  const endpoint = await readEndpoint(dataDir);
  if (!endpoint) throw new Error(`No endpoint metadata in ${dataDir}; is the service running?`);
  const token = await readLocalToken(dataDir);
  if (!token) throw new Error('Local service token is missing.');
  const response = await fetch(`${endpoint.url}/v1/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Status failed with HTTP ${response.status}.`);
  process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
}

async function stop(flags: Flags): Promise<void> {
  const dataDir = path.resolve(locate(flags));
  const endpoint = await readEndpoint(dataDir);
  if (!endpoint) {
    process.stdout.write('Service is not running (no endpoint metadata).\n');
    return;
  }
  const token = await readLocalToken(dataDir);
  if (!token) throw new Error('Local service token is missing.');
  const response = await fetch(`${endpoint.url}/v1/admin/shutdown`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!response || !response.ok)
    throw new Error('Shutdown request failed; the service may already be gone.');
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const live = await readEndpoint(dataDir);
    if (!live) break;
    try {
      process.kill(live.pid, 0);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.stdout.write('Stop requested; endpoint cleared.\n');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv[0] === 'help') {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }
  if (argv.includes('--version') || argv.includes('-v') || argv[0] === 'version') {
    const { version, engines } = readServiceManifest();
    process.stdout.write(`agent-service ${version}\nNode.js ${engines}\n`);
    process.exit(0);
  }
  const [command, ...rest] = argv;
  try {
    assertSupportedNode();
    // `approve` takes two positionals before its flags: `approve mcp <serverId>`.
    const positionals = command === 'approve' ? rest.splice(0, 2) : [];
    const flags = parseFlags(rest);
    switch (command) {
      case 'serve':
        await serve(flags);
        break;
      case 'status':
        await status(flags);
        break;
      case 'stop':
        await stop(flags);
        break;
      case 'approve': {
        const [kind, serverId] = positionals;
        if (kind !== 'mcp' || !serverId) throw new Error('Usage: approve mcp <serverId>');
        await approveMcp(path.resolve(locate(flags)), serverId, { yes: flags.yes ?? false });
        break;
      }
      case undefined:
      default:
        process.stdout.write(`${usage()}\n`);
        process.exit(command === undefined ? 0 : 1);
    }
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    if (command === 'serve') {
      try {
        const dataDir = resolveDataDir({
          envDir: process.env.AI_AGENT_DATA_DIR,
          flagDir: parseFlags(process.argv.slice(3)).dataDir,
        });
        const { servicePaths } = await import('./storage.js');
        await releaseLock(servicePaths(dataDir));
      } catch {
        // Best effort; the lock holder (if any) keeps its lease.
      }
    }
    process.exit(1);
  }
}

void main();
