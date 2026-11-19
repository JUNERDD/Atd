/** Launches through NSWorkspace, retaining ownership until the exact new app has terminated. */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { nativeHostArch } from './arch.mjs';

const exec = promisify(execFile);
const helper = fileURLToPath(new URL('./dev-launch.swift', import.meta.url));
const LAUNCHER_VERSION = 1;

function statStamp(file) {
  try {
    const stat = lstatSync(file, { bigint: true });
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return null;
  }
}

/**
 * Compiles `dev-launch.swift` once into `DerivedData/dev-launch` so repeated `pnpm dev` launches
 * run a ~6ms Mach-O binary instead of paying `/usr/bin/swift`'s ~250-400ms JIT startup every time.
 * Falls back to `/usr/bin/swift` if compilation fails or is cancelled.
 */
export async function prepareDevLauncher({ packageRoot, signal }) {
  const fallback = { executable: '/usr/bin/swift', args: [helper] };
  try {
    const sourceHash = createHash('sha256').update(readFileSync(helper)).digest('hex');
    const arch = nativeHostArch();
    const { stdout: swiftcStdout } = await exec('xcrun', ['--find', 'swiftc'], {
      encoding: 'utf8',
      signal,
      timeout: 5000,
    });
    const swiftc = swiftcStdout.trim();
    const swiftcStamp = statStamp(swiftc);
    if (!swiftc || !swiftcStamp) return fallback;

    const derived = path.join(packageRoot, 'DerivedData');
    const binary = path.join(derived, 'dev-launch');
    const receiptPath = path.join(derived, 'dev-launch.json');
    const currentBinaryStamp = statStamp(binary);
    if (currentBinaryStamp) {
      try {
        const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
        if (
          receipt?.version === LAUNCHER_VERSION &&
          receipt.sourceHash === sourceHash &&
          receipt.arch === arch &&
          receipt.swiftc === swiftc &&
          receipt.swiftcStamp === swiftcStamp &&
          receipt.binaryStamp === currentBinaryStamp
        ) {
          return { executable: binary, args: [] };
        }
      } catch {
        // Recompile when receipt is missing or unreadable.
      }
    }

    mkdirSync(derived, { recursive: true });
    const temporary = `${binary}.${process.pid}.tmp`;
    try {
      await exec('xcrun', ['swiftc', '-Onone', helper, '-o', temporary], {
        encoding: 'utf8',
        signal,
        timeout: 30_000,
      });
      renameSync(temporary, binary);
      const binaryStamp = statStamp(binary);
      const receiptTemp = `${receiptPath}.${process.pid}.tmp`;
      writeFileSync(
        receiptTemp,
        JSON.stringify({
          version: LAUNCHER_VERSION,
          sourceHash,
          arch,
          swiftc,
          swiftcStamp,
          binaryStamp,
        }),
      );
      renameSync(receiptTemp, receiptPath);
      return { executable: binary, args: [] };
    } catch {
      rmSync(temporary, { force: true });
      return fallback;
    }
  } catch {
    return fallback;
  }
}

export function startDevApp({ appPath, bundleId, environment, launcher }) {
  const target = launcher ?? { executable: '/usr/bin/swift', args: [helper] };
  const child = spawn(
    target.executable,
    [...target.args, appPath, bundleId, JSON.stringify(environment)],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      // Ctrl+C must reach the supervisor first. Closing stdin asks the helper to stop its app;
      // killing the launcher could leave a LaunchServices request without its ownership answer.
      detached: true,
    },
  );
  let pid;
  let exited = false;
  let stopping = false;
  let settled = false;
  let problem;
  let acknowledgeStart;
  const started = new Promise((resolve) => {
    acknowledgeStart = resolve;
  });
  const timer = setTimeout(() => {
    problem = 'LaunchServices did not finish starting the Debug app within 30 seconds.';
    requestStop();
    acknowledgeStart(false);
  }, 30_000);
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.kind === 'started' && Number.isInteger(message.pid) && message.pid > 0) {
      pid = message.pid;
      clearTimeout(timer);
      acknowledgeStart(!stopping);
    } else if (message?.kind === 'error' && typeof message.message === 'string') {
      problem = message.message;
      settled = pid === undefined;
    } else if (message?.kind === 'exited' || message?.kind === 'notStarted') {
      settled = true;
    }
  });
  child.stderr.on('data', (data) => {
    problem = `${problem ?? ''}${data}`.slice(-4000).trim();
  });
  child.stdin.on('error', (error) => {
    if (error.code !== 'EPIPE') problem = error.message;
  });
  const done = new Promise((resolve) => {
    child.once('error', (error) => {
      problem = error.message;
      settled = true; // The helper process itself could not spawn.
      finish(false);
    });
    child.once('close', (code) => finish(code === 0 && pid !== undefined && settled));
    function finish(ok) {
      exited = true;
      if (!settled) problem = 'The launch helper exited without confirming its App had stopped.';
      clearTimeout(timer);
      lines.close();
      acknowledgeStart(false);
      resolve(ok);
    }
  });

  function requestStop() {
    stopping = true;
    if (!exited) child.stdin.end();
  }

  return {
    started,
    done,
    get pid() {
      return pid;
    },
    get problem() {
      return problem;
    },
    get running() {
      return !exited || !settled;
    },
    async stop() {
      requestStop();
      let timeout;
      try {
        await Promise.race([
          done,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('The owned Debug app launch has not finished cleanup.')),
              30_000,
            );
          }),
        ]);
        if (!settled) throw new Error(problem);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
