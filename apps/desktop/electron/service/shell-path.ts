import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import log from 'electron-log/main';

// A macOS app started by launchd (Finder, Dock, login item) or a Linux desktop entry inherits a
// minimal PATH, so the agent service and every command it runs (shell tool, MCP stdio servers,
// ripgrep) miss tools the user installed through nvm, fnm, volta, asdf, pyenv, cargo, go, bun or
// their own rc-file PATH lines. This module asks the user's shell for its PATH once per app run,
// the way VS Code (`src/vs/platform/shell/node/shellEnv.ts`) and Goose
// (`ui/desktop/src/loginShellPath.ts`) do. sindresorhus/shell-env (and shell-path / fix-path on
// top of it) was not used: it has no timeout and cannot kill a hung shell, pipes stdin into the
// interactive shell, silently falls back to the app's own environment so a failure cannot be
// reported, and fix-path resolves synchronously on the main thread.
//
// Only PATH is taken, never the whole shell environment: an imported AI_AGENT_*, NODE_OPTIONS or
// ELECTRON_* value from an rc file would change which data dir, runtime or flags the service
// uses, which the app's own environment decides.

const logger = log.scope('shell-env');

/**
 * Upper bound on the shell run. A healthy interactive zsh with nvm and oh-my-zsh answers in about
 * 1 s; the service spawn waits on this, so a broken rc file may delay the connecting state by at
 * most this long. Goose uses the same 5 s; VS Code's 10 s default guards a terminal env that is
 * not on the app's startup path.
 */
const RESOLVE_TIMEOUT_MS = 5000;

/** Carries the per-run delimiter into the shell, so the command itself needs no quoting. */
const MARK_VARIABLE = 'AI_SHELL_PATH_MARK';

/**
 * `printenv` is an external command, so the same text works in POSIX shells and fish (whose
 * `echo $PATH` would space-join the list). The delimiters fence off whatever rc files print.
 */
const PRINT_PATH = `printenv ${MARK_VARIABLE}; printenv PATH; printenv ${MARK_VARIABLE}`;

/** Interactive login shell, since nvm-style setups live in interactive rc files. */
function shellArgs(shell: string): string[] {
  // csh and tcsh reject `-l` next to other flags; VS Code runs them as interactive shells, which
  // still read ~/.cshrc (tcsh reads ~/.login after it, so login-only PATH lines are missed).
  return /^t?csh$/.test(path.basename(shell))
    ? ['-i', '-c', PRINT_PATH]
    : ['-i', '-l', '-c', PRINT_PATH];
}

/** The PATH between the delimiters, once both have been printed in full. */
function extractPath(stdout: string, mark: string): string | null {
  const start = stdout.indexOf(`${mark}\n`);
  if (start === -1) return null;
  const from = start + mark.length + 1;
  const end = stdout.indexOf(`\n${mark}\n`, from);
  if (end === -1) return null;
  const value = stdout.slice(from, end);
  return value && !value.includes('\n') ? value : null;
}

/**
 * Windows GUI apps already inherit the full PATH. Unpackaged builds run from a terminal whose
 * PATH is already complete and may carry a project's venv or direnv changes a login shell would
 * drop, as VS Code skips the resolution when started from its CLI.
 */
function resolveLoginShellPath(): Promise<string | null> {
  if (process.platform === 'win32' || !app.isPackaged) return Promise.resolve(null);
  const started = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    let shell = '(unknown shell)';
    let child: ChildProcess | undefined;
    const finish = (value: string | null, problem: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const elapsed = Math.round(performance.now() - started);
      if (value !== null)
        logger.info(
          `Resolved the PATH of ${shell} in ${elapsed} ms (${value.split(path.delimiter).length} entries).`,
        );
      else
        logger.warn(
          `Could not resolve the PATH of ${shell} after ${elapsed} ms (${problem}); the agent service keeps the app's PATH.`,
        );
      resolve(value);
    };
    const timer = setTimeout(() => {
      // An interactive shell ignores SIGTERM, and rc files may have started children in its
      // process group (the shell leads it: `detached`), so the whole group gets SIGKILL.
      if (child?.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // The group already exited.
        }
      }
      finish(null, `timed out after ${RESOLVE_TIMEOUT_MS} ms`);
    }, RESOLVE_TIMEOUT_MS);
    try {
      shell = process.env.SHELL || userInfo().shell || '';
      if (!shell) throw new Error('no login shell is configured');
      const mark = randomUUID();
      child = spawn(shell, shellArgs(shell), {
        // A new session keeps the interactive shell's job control away from any terminal the app
        // was started from; stdin is closed so an rc file that reads it cannot block.
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          ...process.env,
          [MARK_VARIABLE]: mark,
          // oh-my-zsh: skip the auto-update prompt and the tmux plugin's autostart (as shell-env).
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTARTED: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
        },
      });
      const stdout = child.stdout;
      if (stdout === null) throw new Error('the shell has no stdout pipe');
      let output = '';
      stdout.setEncoding('utf8');
      // Settles on the closing delimiter instead of `close`: a background job an rc file started
      // can hold the pipe open long after the shell has printed PATH and exited.
      stdout.on('data', (chunk: string) => {
        output += chunk;
        const value = extractPath(output, mark);
        if (value === null) return;
        finish(value, null);
        stdout.destroy();
      });
      child.once('error', (error) => finish(null, error.message));
      child.once('close', (code, signal) =>
        finish(null, `exited with ${signal ?? `code ${code}`} before printing PATH`),
      );
    } catch (error) {
      finish(null, error instanceof Error ? error.message : String(error));
    }
  });
}

/**
 * Started when the module loads — main imports the launcher statically — so the shell run
 * overlaps app startup instead of adding to the first service spawn. Settled once per app run;
 * respawns reuse it.
 */
const pending = resolveLoginShellPath();

/**
 * The user's login-shell PATH, or the app's own PATH when the shell could not answer or was not
 * asked (Windows and unpackaged builds, see resolveLoginShellPath). Waits at most RESOLVE_TIMEOUT_MS from
 * app start.
 */
export async function loginShellPath(): Promise<string> {
  const started = performance.now();
  const resolved = await pending;
  const waited = Math.round(performance.now() - started);
  if (waited > 0) logger.info(`The service spawn waited ${waited} ms for the shell PATH.`);
  return resolved ?? process.env.PATH ?? '';
}
