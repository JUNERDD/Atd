#!/usr/bin/env node
/**
 * Supervises the Vite renderer dev server (`@atd/desktop#dev:renderer`).
 *
 * Turbo watch spawns persistent tasks in a pseudo-terminal, which makes `process.stdin.isTTY` true
 * inside bare `vite` (enabling `q` quit and `o` browser shortcuts) and never restarts a persistent
 * task that exits on its own. Piping stdin with an explicit `process.stdin.resume()` preload keeps
 * `isTTY` false while ensuring pipe EOF actually fires if this supervisor is killed (`SIGKILL`),
 * and unexpected Vite exits automatically restart with bounded backoff.
 */
import { spawn } from 'node:child_process';
import { fstatSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const RENDERER_HOST = '127.0.0.1';
const STABLE_UPTIME_MS = 5_000;
const BASE_BACKOFF_MS = 250;
const MAX_BACKOFF_MS = 5_000;

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const forwardedArgs = process.argv.slice(2);

// Vite only attaches `process.stdin.on('end', ...)` without resuming stdin when `!isTTY`, leaving
// Node's stdin stream paused so pipe EOF on supervisor SIGKILL would never fire without `resume()`.
const PARENT_EOF_PRELOAD = `data:text/javascript,${encodeURIComponent(
  "process.stdin.on('end',()=>{setTimeout(()=>process.exit(0),3000).unref();if(process.listenerCount('SIGTERM')===0||process.env.CI==='true')process.kill(process.pid,'SIGTERM')});process.stdin.resume();",
)}`;

function isOneShotFlag(args) {
  for (const arg of args) {
    if (arg === '--') break;
    if (arg === '-h' || arg === '--help' || arg === '-v' || arg === '--version') return true;
  }
  return false;
}

function resolveConfiguredPort(args) {
  let configured;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') break;
    if (arg === '--port') {
      configured = args[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('--port=')) {
      configured = arg.slice('--port='.length);
    }
  }
  const raw = configured ?? process.env.AI_RENDERER_PORT ?? '5173';
  const port = raw.trim() === '' ? Number.NaN : Number(raw);
  return { port, raw, fromCli: configured !== undefined };
}

function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

// `stdio: 'ignore'` and `< /dev/null` bind fd 0 to a character device where `!isTTY` is true and
// `resume()` immediately emits `'end'`. Only watch stdin EOF when fd 0 is an actual pipe or socket.
function hasParentPipeStdin() {
  if (process.stdin.isTTY) return false;
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isSocket();
  } catch {
    return false;
  }
}

function log(message) {
  console.error(`[renderer] ${message}`);
}

if (isOneShotFlag(forwardedArgs)) {
  const child = spawn(process.execPath, [viteBin, ...forwardedArgs], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  child.once('exit', (code) => process.exit(code ?? 0));
  child.once('error', (error) => {
    log(error.message);
    process.exit(1);
  });
} else {
  await runSupervisor();
}

async function runSupervisor() {
  const { port: rendererPort, raw: rawPort, fromCli } = resolveConfiguredPort(forwardedArgs);
  if (!Number.isInteger(rendererPort) || rendererPort < 1 || rendererPort > 65535) {
    log(`${fromCli ? '--port' : 'AI_RENDERER_PORT'} must be a TCP port, not ${rawPort}.`);
    process.exit(1);
  }

  if (!(await isPortFree(RENDERER_HOST, rendererPort))) {
    log(
      `${RENDERER_HOST}:${rendererPort} is already in use. Stop the existing dev server first, or set AI_RENDERER_PORT to a free port.`,
    );
    process.exit(1);
  }

  const lifetime = new AbortController();
  let stopping = false;
  let currentChild = null;
  let stopPromise = null;

  function stopChild(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // Process already exited.
          }
        }
      }, 5_000);
      killTimer.unref();
      child.once('close', () => {
        clearTimeout(killTimer);
        resolve();
      });
      try {
        child.stdin?.end();
      } catch {
        // Pipe already closed.
      }
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already exited.
      }
    });
  }

  function shutdown() {
    if (stopPromise) return stopPromise;
    stopping = true;
    lifetime.abort();
    stopPromise = stopChild(currentChild).then(() => {
      process.exit(0);
    });
    return stopPromise;
  }

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      void shutdown();
    });
  }
  if (hasParentPipeStdin()) {
    process.stdin.on('end', () => {
      void shutdown();
    });
    process.stdin.on('close', () => {
      void shutdown();
    });
    process.stdin.on('error', () => {
      void shutdown();
    });
    process.stdin.resume();
  }

  let consecutiveFastExits = 0;

  while (!stopping) {
    const startedAt = performance.now();
    const exit = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        ['--import', PARENT_EOF_PRELOAD, viteBin, ...forwardedArgs],
        {
          cwd: packageRoot,
          stdio: ['pipe', 'inherit', 'inherit'],
        },
      );
      currentChild = child;
      child.stdin.on('error', () => {});
      child.once('error', (error) => {
        if (currentChild === child) currentChild = null;
        resolve({ code: 1, signal: null, error });
      });
      child.once('close', (code, signal) => {
        if (currentChild === child) currentChild = null;
        resolve({ code, signal, error: null });
      });
    });

    if (stopping) break;

    const uptimeMs = performance.now() - startedAt;
    if (uptimeMs >= STABLE_UPTIME_MS) {
      consecutiveFastExits = 0;
    } else {
      consecutiveFastExits += 1;
    }

    const backoffMs = Math.min(
      MAX_BACKOFF_MS,
      BASE_BACKOFF_MS * 2 ** Math.max(0, consecutiveFastExits - 1),
    );
    const detail = exit.error
      ? exit.error.message
      : exit.signal
        ? `signal ${exit.signal}`
        : `code ${exit.code ?? 0}`;

    await delay(backoffMs, undefined, { signal: lifetime.signal }).catch(() => {});
    if (stopping) break;

    if (!(await isPortFree(RENDERER_HOST, rendererPort))) {
      await delay(250, undefined, { signal: lifetime.signal }).catch(() => {});
      if (stopping) break;
      if (!(await isPortFree(RENDERER_HOST, rendererPort))) {
        log(
          `Vite exited (${detail}) and ${RENDERER_HOST}:${rendererPort} is held by another process; stopping supervisor.`,
        );
        process.exit(1);
      }
    }

    log(`Vite dev server exited (${detail}); restarting…`);
  }
}
