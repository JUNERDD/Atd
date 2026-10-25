/** Launches through NSWorkspace, retaining ownership until the exact new app has terminated. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('./dev-launch.swift', import.meta.url));

export function startDevApp({ appPath, bundleId, environment }) {
  const child = spawn('/usr/bin/swift', [helper, appPath, bundleId, JSON.stringify(environment)], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // Ctrl+C must reach the supervisor first. Closing stdin asks the helper to stop its app;
    // killing the launcher could leave a LaunchServices request without its ownership answer.
    detached: true,
  });
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
