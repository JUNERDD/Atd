import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

/**
 * ripgrep for grep and find. pi's grep resolves `rg` through its tools manager, which downloads
 * a binary when `rg` is neither in pi's bin dir nor on PATH, and pi's find uses `fd` the same way.
 * The service never lets a tool download binaries: grep runs only once `rg` is found on PATH
 * (the tools manager then returns it without a download), and find globs through the `rg` found
 * here. The desktop launcher adds the common Homebrew and /usr/local dirs to the service PATH.
 */

const MISSING =
  'ripgrep (rg) is required for grep and find but was not found on PATH. Install ripgrep (for example `brew install ripgrep`) and restart the app.';

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

/**
 * Files under `root` matching `pattern`, as paths relative to `root`: `rg --files` with the
 * pattern as a glob (gitignore semantics: a pattern without `/` matches at any depth), hidden
 * files included, `.gitignore` respected, symlinks not followed. Stops at `limit` results.
 */
export async function ripgrepFiles(
  pattern: string,
  root: string,
  options: { ignore: string[]; limit: number },
): Promise<string[]> {
  const rg = await resolveRipgrep();
  const args = ['--files', '--hidden', '--color=never', '--glob', pattern];
  for (const ignored of options.ignore) args.push('--glob', `!${ignored}`);
  return new Promise((resolve, reject) => {
    const child = spawn(rg, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = createInterface({ input: child.stdout });
    const found: string[] = [];
    let stderr = '';
    let limited = false;
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    lines.on('line', (line) => {
      if (!line || found.length >= options.limit) return;
      found.push(line);
      if (found.length >= options.limit) {
        limited = true;
        child.kill();
      }
    });
    child.on('error', (error) => reject(new Error(`Failed to run ripgrep: ${error.message}`)));
    child.on('close', (code) => {
      lines.close();
      // rg exits 1 when nothing matched; a limit stop kills it.
      if (limited || code === 0 || code === 1) resolve(found.sort());
      else reject(new Error(stderr.trim() || `ripgrep exited with code ${code ?? 'unknown'}`));
    });
  });
}
