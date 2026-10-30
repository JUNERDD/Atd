import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { PathGlob } from './glob.js';

/**
 * ripgrep for grep and find. pi's grep resolves `rg` through its tools manager, which downloads
 * a binary when `rg` is neither in pi's bin dir nor on PATH, and pi's find uses `fd` the same way.
 * The service never lets a tool download binaries: both run the `rg` found here on PATH, through
 * `runRipgrep`, so they share one ignore policy. The desktop launcher adds the common Homebrew and
 * /usr/local dirs to the service PATH.
 */

const MISSING =
  'ripgrep (rg) is required for grep and find but was not found on PATH. Install ripgrep (for example `brew install ripgrep`) and restart the app.';

/**
 * The flags every rg call starts with, so grep and find see the same files: no user rg config
 * (`RIPGREP_CONFIG_PATH` could add `--follow` or `--no-ignore`), hidden files included, ignore
 * files read as rg reads them (`.gitignore` inside git work trees, `.ignore` and `.rgignore`
 * anywhere), links not followed, and every `.git` and `node_modules` below the search root
 * skipped. The root itself is always searched, so a path inside one of those still works when
 * named.
 */
const COMMON_ARGS = ['--no-config', '--hidden', '--glob', '!.git', '--glob', '!node_modules'];

/** Absolute path of the first executable `rg` on PATH; throws a clear error when absent. */
export async function resolveRipgrep(): Promise<string> {
  const names = process.platform === 'win32' ? ['rg.exe', 'rg'] : ['rg'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  throw new Error(MISSING);
}

/** rg's own narrowing to the files `glob` can pass: a type, which keeps the ignore rules. */
export function nameFilterArgs(glob: PathGlob | null): string[] {
  return glob?.name ? ['--type-add', `atdglob:${glob.name}`, '--type', 'atdglob'] : [];
}

/**
 * Runs rg with `COMMON_ARGS` and `args` in `cwd`, handing each output line to `onLine` until it
 * answers false, which stops rg. Abort stops rg and rejects with pi's `Operation aborted`; any exit
 * other than a match (0), no match (1) or a stop rejects with rg's error output.
 */
export async function runRipgrep(
  args: readonly string[],
  options: { cwd: string; signal?: AbortSignal | undefined; onLine: (line: string) => boolean },
): Promise<void> {
  const rg = await resolveRipgrep();
  const { signal } = options;
  if (signal?.aborted) throw new Error('Operation aborted');
  return new Promise((resolve, reject) => {
    const child = spawn(rg, [...COMMON_ARGS, ...args], {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill();
    };
    const done = () => {
      lines.close();
      signal?.removeEventListener('abort', stop);
    };
    signal?.addEventListener('abort', stop, { once: true });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    lines.on('line', (line) => {
      if (!stopped && !options.onLine(line)) stop();
    });
    child.on('error', (error) => {
      done();
      reject(new Error(`Failed to run ripgrep: ${error.message}`));
    });
    child.on('close', (code) => {
      done();
      if (signal?.aborted) reject(new Error('Operation aborted'));
      else if (stopped || code === 0 || code === 1) resolve();
      else reject(new Error(stderr.trim() || `ripgrep exited with code ${code ?? 'unknown'}`));
    });
  });
}

/**
 * The first `limit` files under `root` that `glob` passes, as paths relative to `root`, in path
 * order (rg's `--sort path`, so the cut is the same on every run). rg lists what the ignore rules
 * keep and the pattern filters that list, so a pattern never brings back an ignored file.
 */
export async function ripgrepFiles(
  root: string,
  options: { glob: PathGlob; limit: number; signal?: AbortSignal | undefined },
): Promise<string[]> {
  const found: string[] = [];
  if (options.limit <= 0) return found;
  const args = ['--files', '--sort', 'path', '--color=never', ...nameFilterArgs(options.glob)];
  await runRipgrep(args, {
    cwd: root,
    signal: options.signal,
    onLine: (line) => {
      if (line && options.glob.matches(line)) found.push(line);
      return found.length < options.limit;
    },
  });
  return found;
}
