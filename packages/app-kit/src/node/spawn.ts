import { spawn } from 'node:child_process';

/** One sandboxed toolchain process (builder, `tsc`, self-check probe) run to completion. */
export interface SandboxedRunSpec {
  command: string;
  args: string[];
  /** The complete environment; never derived from `process.env`. */
  env: Record<string, string>;
  cwd: string;
  timeoutMs: number;
  /** Open a Node IPC channel (fd 3) and collect what the child sends on it. */
  ipc?: boolean;
}

export interface SandboxedRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  /** The last `OUTPUT_TAIL_BYTES` of each stream. */
  stdout: string;
  stderr: string;
  messages: unknown[];
  durationMs: number;
}

const OUTPUT_TAIL_BYTES = 256 * 1024;

function tail(chunks: Buffer[]): string {
  const all = Buffer.concat(chunks);
  return all.subarray(Math.max(0, all.length - OUTPUT_TAIL_BYTES)).toString('utf8');
}

/** Runs the process, killing it (SIGKILL) at the timeout; never rejects for a failing child. */
export function runSandboxed(spec: SandboxedRunSpec): Promise<SandboxedRun> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: spec.ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const messages: unknown[] = [];
    let timedOut = false;
    const keep = (target: Buffer[]) => (chunk: Buffer) => {
      target.push(chunk);
      // Bound memory: drop the oldest chunks once well past the tail size.
      while (target.length > 1 && Buffer.concat(target).length > OUTPUT_TAIL_BYTES * 2)
        target.shift();
    };
    child.stdout?.on('data', keep(stdout));
    child.stderr?.on('data', keep(stderr));
    child.on('message', (message) => messages.push(message));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, spec.timeoutMs);
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      resolve({
        code,
        signal,
        timedOut,
        stdout: tail(stdout),
        stderr: tail(stderr),
        messages,
        durationMs: Math.round(performance.now() - started),
      });
    };
    child.on('error', (error) => {
      stderr.push(Buffer.from(`${error.message}\n`));
      finish(null, null);
    });
    child.on('close', finish);
  });
}
