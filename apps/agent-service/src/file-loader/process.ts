import { execFile, type ExecFileException } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export interface ProcessResult {
  stdout: Buffer;
  stderr: Buffer;
}

export interface ProcessOptions {
  timeoutMs: number;
  /** Most bytes either output stream may carry before the tool is killed. */
  maxBuffer: number;
  signal?: AbortSignal;
}

/**
 * Runs a system tool by its absolute path with literal arguments. Rejects with a short reason when
 * the tool fails, outlives `timeoutMs` or says too much, and with an `AbortError` when `signal`
 * aborts. The loader takes it as a dependency, so other platforms and tests run without the tools.
 */
export type RunProcess = (
  file: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;

/** `execFile` without a shell; a tool past its time is killed with SIGKILL. */
export const runProcess: RunProcess = (file, args, { timeoutMs, maxBuffer, signal }) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: 'buffer',
        timeout: timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer,
        ...(signal ? { signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) reject(processError(error, stderr, timeoutMs));
        else resolve({ stdout, stderr });
      },
    );
  });

function processError(error: ExecFileException, stderr: Buffer, timeoutMs: number): Error {
  if (error.name === 'AbortError') return error;
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
    return new Error('the converted output is too large');
  if (error.killed && error.signal === 'SIGKILL')
    return new Error(`it took longer than ${Math.round(timeoutMs / 1000)} seconds`);
  const said = stderr.toString('utf8').trim().split('\n', 1)[0];
  return new Error(said || `${path.basename(error.cmd ?? 'the tool')} failed`);
}

/**
 * Writes `bytes` to a file of extension `extension` in a private temporary directory (mode 0700,
 * the file 0600), runs `task` on it and removes the directory, whatever `task` does. Tools that
 * pick a reader by extension (Spotlight) get the right one; none touches the original file.
 */
export async function withTempFile<T>(
  bytes: Uint8Array,
  extension: string,
  task: (file: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'atd-file-loader-'));
  try {
    const file = path.join(dir, extension ? `file.${extension}` : 'file');
    await writeFile(file, bytes, { mode: 0o600 });
    return await task(file, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
