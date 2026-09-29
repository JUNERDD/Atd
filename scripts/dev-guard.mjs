#!/usr/bin/env node
/**
 * Preflight for `pnpm dev` and `pnpm dev:electron`, which must never run at the same time.
 *
 * Both start the Vite renderer dev server on the fixed 127.0.0.1:5173 (`strictPort`), so a
 * second one would fail late with a bare "port in use". `pnpm dev:electron` must also run in an
 * isolated profile: without AI_TEST_USER_DATA, the Electron dev app resolves its service to the
 * default data dir and, by the autostart rule, replaces the service of the installed app.
 *
 * Usage: node scripts/dev-guard.mjs dev|electron
 */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';

const RENDERER_HOST = '127.0.0.1';
const RENDERER_PORT = 5173;
/** Owned by `pnpm dev`'s service (see the agent service `dev` script). */
const DEV_DATA_DIR = path.join(homedir(), 'Library', 'Application Support', 'AgentService Dev');

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'electron') fail('Usage: node scripts/dev-guard.mjs dev|electron');

if (mode === 'electron' && !process.env.AI_TEST_USER_DATA?.trim()) {
  fail(
    'pnpm dev:electron needs an isolated profile. Run: AI_TEST_USER_DATA=$(mktemp -d) pnpm dev:electron',
  );
}

if (mode === 'electron') {
  // The dev service can outlive a crashed Vite, so the port alone does not prove it is gone.
  // An explicit AI_AGENT_DATA_DIR is where the Electron dev app would start (and replace) a service.
  const dirs = new Set([DEV_DATA_DIR, process.env.AI_AGENT_DATA_DIR?.trim()].filter(Boolean));
  for (const dir of dirs) {
    const pid = liveLockOwner(dir);
    if (pid !== null) {
      fail(
        `An agent service (pid ${pid}) owns ${dir}; pnpm dev is probably running. Stop it before pnpm dev:electron.`,
      );
    }
  }
}

if (!(await isPortFree(RENDERER_HOST, RENDERER_PORT))) {
  const other = mode === 'dev' ? 'pnpm dev:electron' : 'pnpm dev';
  fail(
    `${RENDERER_HOST}:${RENDERER_PORT} is in use: ${other}, pnpm dev:renderer or another dev server is running. Stop it first; pnpm dev and pnpm dev:electron never run together.`,
  );
}

/** Pid recorded in the dir's `service.lock` when that process is still alive, else null. */
function liveLockOwner(dir) {
  let pid;
  try {
    pid = JSON.parse(readFileSync(path.join(dir, 'service.lock'), 'utf8')).pid;
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error.code === 'EPERM' ? pid : null;
  }
}

/** Binds the port the way Vite does; a bind failure means someone else listens there. */
function isPortFree(host, port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen({ host, port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}
