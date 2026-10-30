import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FindOperations, GrepOperations, LsOperations } from '@earendil-works/pi-coding-agent';
import { inside, resolveToolPath } from '../../service-fs.js';
import { pathGlob } from './glob.js';
import { ripgrepFiles } from './ripgrep.js';

/** Thrown before the gate when a grep/find/ls path leaves the task folder and its extra roots. */
export const OUTSIDE_TASK_FOLDER = 'File access outside the task folder is blocked.';

/**
 * The real directories (or files) one grep/find/ls call may reach: the task folder, and the extra
 * roots the caller allows for this call. Resolved once per call, so the operations, which may run
 * once per listed entry, only take the real path of what they touch.
 */
export interface SearchRoots {
  task: string;
  extra: readonly string[];
}

/** `root` and `extraRoots` as real paths, for one call. */
export async function resolveRoots(
  root: string,
  extraRoots: readonly string[] = [],
): Promise<SearchRoots> {
  const [task, ...extra] = await Promise.all(
    [root, ...extraRoots].map((allowed) => realOrNearest(path.resolve(allowed))),
  );
  return { task: task ?? path.resolve(root), extra };
}

/**
 * Real path of `target`, required to lie inside one of `roots`. A missing path resolves through
 * its nearest existing ancestor, so a missing name under a symlink that leads outside still counts
 * as outside.
 */
export async function confineTo(roots: SearchRoots, target: string): Promise<string> {
  const real = await realOrNearest(path.resolve(roots.task, target));
  if (inside(roots.task, real) || roots.extra.some((allowed) => inside(allowed, real))) return real;
  throw new Error(OUTSIDE_TASK_FOLDER);
}

/**
 * Confines a grep/find/ls `path` argument (default: the task folder) as pi resolves it against
 * `cwd`: `@`, `~` and `file://` spellings resolve like pi's tools before the containment check.
 * Answers whether it lands in the task folder or in an extra root, which decides the gate scope.
 */
export async function confineToolArgument(
  roots: SearchRoots,
  cwd: string,
  rawPath: string | undefined,
): Promise<'inside' | 'outside'> {
  const real = await confineTo(roots, resolveToolPath(cwd, rawPath || '.'));
  return inside(roots.task, real) ? 'inside' : 'outside';
}

async function realOrNearest(absolute: string): Promise<string> {
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      return path.join(await realpath(current), ...missing.reverse());
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * pi's pluggable grep/find/ls operations for one call, each confined to `roots`. They are the
 * second line of confinement after the argument check: every path pi touches (search roots,
 * context-line file reads, listed entries) must stay inside those roots. find globs through
 * ripgrep with the call's `signal`, never through pi's fd download path.
 */
export function searchOperations(
  roots: SearchRoots,
  signal?: AbortSignal,
): { grep: GrepOperations; find: FindOperations; ls: LsOperations } {
  const real = (target: string) => confineTo(roots, target);
  const exists = async (target: string) => {
    const resolved = await real(target);
    try {
      await stat(resolved);
      return true;
    } catch {
      return false;
    }
  };
  return {
    grep: {
      isDirectory: async (target) => (await stat(await real(target))).isDirectory(),
      readFile: async (target) => readFile(await real(target), 'utf8'),
    },
    find: {
      exists,
      // pi asks to skip `node_modules` and `.git`, which every rg call skips (ripgrep.ts).
      glob: async (pattern, cwd, options) =>
        ripgrepFiles(await real(cwd), { glob: pathGlob(pattern), limit: options.limit, signal }),
    },
    ls: {
      exists,
      stat: async (target) => stat(await real(target)),
      readdir: async (target) => readdir(await real(target)),
    },
  };
}
