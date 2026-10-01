import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { errorMessage } from '@ai/agent-contracts';
import type { Logger } from './logging.js';

// A macOS app started by launchd (Finder, Dock, login item) or a Linux desktop entry inherits a
// minimal PATH, so the service it launches and every command the service runs (shell tool, MCP
// stdio servers, ripgrep) miss tools the user installed through nvm, fnm, volta, asdf, pyenv,
// cargo, go, bun or their own rc-file PATH lines. `serve --login-shell-path` asks the user's shell
// for its PATH once, the way VS Code (`src/vs/platform/shell/node/shellEnv.ts`) and Goose
// (`ui/desktop/src/loginShellPath.ts`) do. sindresorhus/shell-env (and shell-path / fix-path on
// top of it) was not used: it has no timeout and cannot kill a hung shell, pipes stdin into the
// interactive shell, silently falls back to the caller's own environment so a failure cannot be
// reported, and fix-path resolves synchronously.
//
// Only PATH is taken, never the whole shell environment: an imported AI_AGENT_*, NODE_OPTIONS or
// similar value from an rc file would change which data dir, runtime or flags the service uses,
// which its launcher decides. The flag stays off for a service started from a terminal, whose PATH
// is already complete and may carry a project's venv or direnv changes a login shell would drop.

/**
 * Upper bound on the shell run. A healthy interactive zsh with nvm and oh-my-zsh answers in about
 * 1 s; startup waits on this, so a broken rc file delays the service by at most this long. Goose
 * uses the same 5 s.
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

/** The login shell's PATH, or null (with the reason) when it could not answer in time. */
function resolveLoginShellPath(): Promise<{ value: string; shell: string } | { problem: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let shell = '(unknown shell)';
    let child: ChildProcess | undefined;
    const finish = (value: string | null, problem: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value !== null ? { value, shell } : { problem: `${shell}: ${problem}` });
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
        // A new session keeps the interactive shell's job control away from any terminal the
        // service was started from; stdin is closed so an rc file that reads it cannot block.
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
        finish(value, '');
        stdout.destroy();
      });
      child.once('error', (error) => finish(null, error.message));
      child.once('close', (code, signal) =>
        finish(null, `exited with ${signal ?? `code ${code}`} before printing PATH`),
      );
    } catch (error) {
      finish(null, errorMessage(error));
    }
  });
}

/**
 * Replaces `process.env.PATH` with the login shell's PATH, followed by the inherited entries it
 * lacks, so a launcher's own additions (the bundled Node's directory, Homebrew fallbacks) stay
 * reachable as the last resort. Must finish before the server is built: MCP stdio servers,
 * ripgrep lookup and tool runs all read `process.env.PATH`. When the shell cannot answer, PATH is
 * left unchanged and the reason logged; Windows GUI apps already inherit the full PATH.
 */
export async function applyLoginShellPath(log: Logger): Promise<void> {
  if (process.platform === 'win32') return;
  const started = performance.now();
  const resolved = await resolveLoginShellPath();
  const elapsedMs = Math.round(performance.now() - started);
  if ('problem' in resolved) {
    log.warn('Login shell PATH could not be resolved; keeping the inherited PATH.', {
      problem: resolved.problem,
      elapsedMs,
    });
    return;
  }
  const entries = resolved.value.split(path.delimiter).filter(Boolean);
  const inherited = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const merged = [...entries, ...inherited.filter((entry) => !entries.includes(entry))];
  process.env.PATH = merged.join(path.delimiter);
  log.info('Using the login shell PATH.', {
    shell: resolved.shell,
    entries: merged.length,
    elapsedMs,
  });
}
