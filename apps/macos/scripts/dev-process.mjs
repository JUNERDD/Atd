/** Process ownership for the native development loop. Never adopts an existing app. */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export function runningAppPid(bundleId) {
  const find = spawnSync('lsappinfo', ['find', `bundleid=${bundleId}`], { encoding: 'utf8' });
  if (find.error || find.status !== 0) throw new Error('Cannot check running Debug apps.');
  const asn = find.stdout.trim().split(/\s+/)[0];
  if (!asn) return null;
  const info = spawnSync('lsappinfo', ['info', '-only', 'pid', asn], { encoding: 'utf8' });
  const pid = Number(/"pid"\s*=\s*(\d+)/i.exec(info.stdout ?? '')?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Cannot identify the running Debug app.');
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return null; // LaunchServices can briefly retain an exited app.
    throw error;
  }
  return pid;
}

/** One supervisor per user: every checkout shares the installed Debug bundle. */
export function lockNativeDev() {
  const file = path.join(tmpdir(), `atd-native-dev-${process.getuid()}.lock`);
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = openSync(file, 'wx', 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      removeStaleLock(file);
      continue;
    }
    writeFileSync(fd, String(process.pid));
    closeSync(fd);
    return () => {
      if (readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file);
    };
  }
  throw new Error('Could not acquire the native dev lock.');
}

function removeStaleLock(file) {
  // Serialize stale-owner cleanup too: two starters must never unlink each other's new lock.
  const reaper = `${file}.cleanup`;
  const fd = openSync(reaper, 'wx', 0o600);
  try {
    let owner;
    try {
      owner = Number(readFileSync(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    if (!Number.isInteger(owner) || owner <= 0)
      throw new Error('Native dev lock is being acquired.');
    try {
      process.kill(owner, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      unlinkSync(file);
      return;
    }
    throw new Error(`Another native dev supervisor is running (pid ${owner}).`);
  } finally {
    closeSync(fd);
    unlinkSync(reaper);
  }
}

/** Owns the detached process group until both its leader and remaining descendants have exited. */
export function startChild(command, args, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options, detached: true });
  let leaderExited = false;
  let extinct = false;
  let draining;
  const started = new Promise((resolve) => {
    child.once('spawn', () => resolve(true));
    child.once('error', () => resolve(false));
  });
  const exited = new Promise((resolve) => {
    child.once('error', () => {
      leaderExited = true;
      extinct = true; // Spawn failed, so no owned process group was created.
      resolve(false);
    });
    child.once('exit', (code) => {
      leaderExited = true;
      resolve(code === 0);
    });
  });

  function signalGroup(signal) {
    if (extinct) return false;
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      // macOS can deny a group probe/signal while its last member exits. Permission denial
      // establishes neither extinction nor successful delivery; keep polling until ESRCH.
      if (error.code === 'EPERM') return true;
      if (error.code !== 'ESRCH') throw error;
      // Never probe or signal this id again: a later process could reuse it.
      extinct = true;
      return false;
    }
  }

  async function waitForGroupExit(milliseconds) {
    const deadline = Date.now() + milliseconds;
    while (signalGroup(0)) {
      if (Date.now() >= deadline) return false;
      await delay(25);
    }
    return true;
  }

  function drainGroup() {
    return (draining ??= (async () => {
      if (!(await started) || !signalGroup(0)) return;
      signalGroup('SIGTERM');
      if (await waitForGroupExit(10_000)) return;
      signalGroup('SIGKILL');
      if (!(await waitForGroupExit(10_000)))
        throw new Error(`Owned native process group ${child.pid} did not exit after SIGKILL.`);
    })().catch((error) => {
      draining = undefined; // A later explicit stop can confirm extinction or retry cleanup.
      throw error;
    }));
  }

  // A build leader can exit naturally while a compiler keeps running. Treat those descendants
  // as unfinished work: drain them before a new build can start or the supervisor lock is released.
  const done = exited.then(async (ok) => {
    await drainGroup();
    return ok;
  });
  return {
    child,
    started,
    done,
    get running() {
      return !leaderExited;
    },
    async stop() {
      await drainGroup();
      // `done` may have reported an earlier cleanup failure; its rejected promise cannot be
      // reused to judge a later successful retry. The leader's exit itself is still authoritative.
      await exited;
    },
  };
}
