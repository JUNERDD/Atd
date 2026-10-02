#!/usr/bin/env node
/**
 * The native app's part of `pnpm dev`: builds the Debug app, waits until the Vite dev server and
 * the dev service answer, then opens it. Ctrl+C in `pnpm dev` quits the app again when this
 * script launched it.
 *
 * The Debug app never starts a service itself (it connects to the one `pnpm dev` runs), and it
 * loads the page once at launch, so it opens only after both are up. A build failure or a missing
 * toolchain is reported without stopping the service and the renderer.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUNDLE_ID = 'com.junerdd.ai.dev';
/** The app's own override (`AI_RENDERER_DEV_ORIGIN`), for isolated runs on another port. */
const rendererOrigin = new URL(
  process.env.AI_RENDERER_DEV_ORIGIN?.trim() || 'http://127.0.0.1:5173',
);
const WAIT_LIMIT_MS = 180_000;
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appPath = path.join(packageRoot, 'DerivedData/Build/Products/Debug/Atd.app');
/** Mirrors the service's resolution: AI_AGENT_DATA_DIR wins over the `dev` script's flag. */
const dataDir =
  process.env.AI_AGENT_DATA_DIR?.trim() ||
  path.join(homedir(), 'Library', 'Application Support', 'AgentService Dev');

/** Set once this script has launched the app, which it then quits on exit. */
let launched = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, quit);

if (process.platform !== 'darwin')
  idle(`The native app is macOS-only; skipped on ${process.platform}.`);
else await main();

async function main() {
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: packageRoot, stdio: 'inherit' });
  if (build.error || build.status !== 0) {
    idle(
      'The Debug app did not build (it needs Xcode 26, XcodeGen and SwiftLint). The service and the renderer keep running; fix the build and run `pnpm --filter @atd/macos dev` to open the app.',
    );
    return;
  }
  if (runningPid() !== null) {
    idle(`The Debug app (${BUNDLE_ID}) is already running; it connects to this service by itself.`);
    return;
  }
  log(`Waiting for the renderer and the service in ${dataDir}…`);
  if (!(await waitFor(servicesReady))) {
    idle('The renderer or the service did not come up; not opening the Debug app.');
    return;
  }
  // The app resolves both from its environment; pass the overrides through.
  const env = ['AI_AGENT_DATA_DIR', 'AI_RENDERER_DEV_ORIGIN']
    .filter((name) => process.env[name]?.trim())
    .flatMap((name) => ['--env', `${name}=${process.env[name].trim()}`]);
  const open = spawnSync('open', [...env, appPath], { stdio: 'inherit' });
  if (open.status !== 0) {
    idle('`open` could not launch the Debug app.');
    return;
  }
  launched = true;
  idle('Opened the Debug app; Ctrl+C quits it with the service.');
}

async function servicesReady() {
  if (!(await answers(rendererOrigin.hostname, Number(rendererOrigin.port)))) return false;
  let url;
  try {
    url = new URL(JSON.parse(readFileSync(path.join(dataDir, 'endpoint.json'), 'utf8')).url);
  } catch {
    return false; // Not written yet, or mid-write.
  }
  return answers(url.hostname, Number(url.port));
}

function answers(host, port) {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const settle = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

async function waitFor(check) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/** The pid of a running Debug app, from LaunchServices, or null. */
function runningPid() {
  const find = spawnSync('lsappinfo', ['find', `bundleid=${BUNDLE_ID}`], { encoding: 'utf8' });
  const asn = find.stdout?.trim().split(/\s+/)[0];
  if (!asn) return null;
  const info = spawnSync('lsappinfo', ['info', '-only', 'pid', asn], { encoding: 'utf8' });
  const pid = Number(/"pid"\s*=\s*(\d+)/i.exec(info.stdout ?? '')?.[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function quit() {
  const pid = launched ? runningPid() : null;
  if (pid !== null) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
  process.exit(0);
}

/** Keeps this persistent turbo task alive, so its exit never ends the rest of `pnpm dev`. */
function idle(message) {
  log(message);
  setInterval(() => {}, 1 << 30);
}

function log(message) {
  console.log(`[macos] ${message}`);
}
