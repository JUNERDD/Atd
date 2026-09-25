#!/usr/bin/env node
/**
 * Agent service CLI: foreground `serve`, plus `status` and `stop` against the
 * dataDir endpoint file. No Electron, no app.getPath, no utilityProcess.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { errorMessage, parse, WebPairingResponseSchema } from '@ai/agent-contracts';
import { prepareServe, readEndpoint, readLocalToken, releaseLock } from './config.js';
import { createService } from './index.js';
import { createLogger } from './logging.js';
import { rollbackMigration } from './migration/rollback.js';
import { runMigration } from './migration/migrate.js';
import { assertSupportedNode, readServiceManifest } from './node-runtime.js';
import { resolveDataDir } from './storage.js';

const RENDERER_PORT = 5173;

interface Flags {
  dataDir?: string;
  host?: string;
  port?: number;
  tier?: 'manual' | 'auto' | 'always';
  source?: string;
  dryRun?: boolean;
  assumeQuiesced?: boolean;
  rollback?: boolean;
  reason?: string;
  webRoot?: string;
  base?: string;
  open?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--dataDir' && argv[index + 1]) flags.dataDir = argv[(index += 1)];
    else if (arg === '--host' && argv[index + 1]) flags.host = argv[(index += 1)];
    else if (arg === '--port' && argv[index + 1]) flags.port = Number(argv[(index += 1)]);
    else if (arg === '--source' && argv[index + 1]) flags.source = argv[(index += 1)];
    else if (arg === '--reason' && argv[index + 1]) flags.reason = argv[(index += 1)];
    else if (arg === '--web-root' && argv[index + 1]) flags.webRoot = argv[(index += 1)];
    else if (arg === '--base' && argv[index + 1]) flags.base = argv[(index += 1)];
    else if (arg === '--open') flags.open = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--assume-quiesced') flags.assumeQuiesced = true;
    else if (arg === '--rollback') flags.rollback = true;
    else if (arg === '--tier' && argv[index + 1]) {
      const tier = argv[(index += 1)];
      if (tier !== 'manual' && tier !== 'auto' && tier !== 'always')
        throw new Error('--tier must be manual, auto or always.');
      flags.tier = tier;
    } else throw new Error(`Unknown argument: ${arg}`);
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
    '  serve [--dataDir <dir>] [--host 127.0.0.1] [--port 0] [--tier manual] [--web-root <dir>]',
    '  status [--dataDir <dir>]',
    '  web [--dataDir <dir>] [--open] [--base <origin>]   Print a one-time browser pairing link',
    '  stop [--dataDir <dir>]',
    '  migrate --source <desktopUserDataCopy> [--dataDir <dir>] [--dry-run] [--assume-quiesced]',
    '  migrate --rollback --reason <text> [--dataDir <dir>]',
    '',
    '  --help, -h       Show this help',
    '  --version, -v    Print version and Node requirement',
    '',
    `Requires Node.js ${engines} on PATH (workspace toolchain; covers Pi 0.86.1`,
    '≥22.19.0). The Electron app binary is not Node.js; there is no auto-download.',
    'AI_AGENT_DATA_DIR overrides --dataDir; AI_AGENT_WEB_ROOT overrides --web-root.',
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
  const config = await prepareServe({
    envDir: process.env.AI_AGENT_DATA_DIR,
    flagDir: flags.dataDir,
    host: flags.host,
    port: flags.port,
    webRoot: process.env.AI_AGENT_WEB_ROOT || flags.webRoot,
  });
  // SIGINT, SIGTERM and `POST /v1/admin/shutdown` all end here. The exit is
  // what ends the process once the service has stopped; nothing else would.
  const shutdown = () => {
    void handle
      .stop()
      .then(() => process.exit(0))
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

/**
 * Mints a one-time pairing code with the local owner token and prints the link that signs a
 * browser in. `--base` points the link at another origin serving the web client (the Vite dev
 * server, which proxies `/v1` here); `--open` also opens it in the default browser.
 */
async function web(flags: Flags): Promise<void> {
  const dataDir = path.resolve(locate(flags));
  const endpoint = await readEndpoint(dataDir);
  if (!endpoint) throw new Error(`No endpoint metadata in ${dataDir}; is the service running?`);
  const token = await readLocalToken(dataDir);
  if (!token) throw new Error('Local service token is missing.');
  const response = await fetch(`${endpoint.url}/v1/web/pairings`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Pairing failed with HTTP ${response.status}.`);
  const { code } = parse(WebPairingResponseSchema, await response.json());
  const link = `${new URL(flags.base ?? endpoint.url).origin}/#pair=${code}`;
  process.stdout.write(`${link}\n`);
  if (!flags.open) return;
  const [command, ...args] =
    process.platform === 'darwin'
      ? ['open', link]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', link]
        : ['xdg-open', link];
  spawn(command!, args, { stdio: 'ignore', detached: true }).unref();
}

/** T2 additive: offline desktop-copy migration, dry-run, or rollback. */
async function migrate(flags: Flags): Promise<void> {
  const log = createLogger(process.env.AI_AGENT_LOG_LEVEL === 'debug' ? 'debug' : 'info');
  const dataDir = path.resolve(locate(flags));
  if (flags.rollback) {
    if (!flags.reason) throw new Error('Rollback requires --reason <text>.');
    const result = await rollbackMigration(dataDir, flags.reason);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (!flags.source) throw new Error('Migration requires --source <desktopUserDataCopy>.');
  const result = await runMigration({
    dataDir,
    sourceRoot: flags.source,
    dryRun: flags.dryRun ?? false,
    assumeQuiesced: flags.assumeQuiesced ?? false,
    log,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.outcomes.some((outcome) => outcome.status === 'failed')) process.exitCode = 1;
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
      case 'web':
        await web(flags);
        break;
      case 'migrate':
        await migrate(flags);
        break;
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
