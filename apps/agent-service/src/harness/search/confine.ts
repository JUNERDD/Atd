import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FindOperations, GrepOperations, LsOperations } from '@earendil-works/pi-coding-agent';
import { inside, resolveToolPath } from '../../service-fs.js';
import { ripgrepFiles } from './ripgrep.js';

/** Thrown before the gate when a grep/find/ls path leaves the task folder and its extra roots. */
export const OUTSIDE_TASK_FOLDER = 'File access outside the task folder is blocked.';

/**
 * Real path of `target` (relative targets resolve against `root`), required to lie inside the
 * real `root` or one of the real `extraRoots`. A missing path resolves through its nearest
 * existing ancestor, so a missing name under a symlink that leads outside still counts as outside.
 */
export async function confineToRoot(
  root: string,
  target: string,
  extraRoots: readonly string[] = [],
): Promise<string> {
  const real = await realOrNearest(path.resolve(root, target));
  for (const allowed of [root, ...extraRoots])
    if (inside(await realOrNearest(path.resolve(allowed)), real)) return real;
  throw new Error(OUTSIDE_TASK_FOLDER);
}

/**
 * Confines a grep/find/ls `path` argument (default: the task folder) as pi resolves it: `@`,
 * `~` and `file://` spellings resolve like pi's tools before the containment check. Answers
 * whether it lands in the task folder or in one of `extraRoots`, which decides the gate scope.
 */
export async function confineToolArgument(
  root: string,
  rawPath: string | undefined,
  extraRoots: readonly string[] = [],
): Promise<'inside' | 'outside'> {
  const real = await confineToRoot(root, resolveToolPath(root, rawPath || '.'), extraRoots);
  return inside(await realOrNearest(path.resolve(root)), real) ? 'inside' : 'outside';
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
 * pi's pluggable grep/find/ls operations, each confined to `root` and the current `extraRoots`. They are the
 * second line of confinement after the argument check: every path pi touches (search roots,
 * context-line file reads, listed entries) must stay inside those roots. find globs through
 * ripgrep, never through pi's fd download path.
 */
export function searchOperations(
  root: string,
  extraRoots: () => Promise<readonly string[]> = async () => [],
): {
  grep: GrepOperations;
  find: FindOperations;
  ls: LsOperations;
} {
  const exists = async (target: string) => {
    const real = await confineToRoot(root, target, await extraRoots());
    try {
      await stat(real);
      return true;
    } catch {
      return false;
    }
  };
  return {
    grep: {
      isDirectory: async (target) =>
        (await stat(await confineToRoot(root, target, await extraRoots()))).isDirectory(),
      readFile: async (target) =>
        readFile(await confineToRoot(root, target, await extraRoots()), 'utf8'),
    },
    find: {
      exists,
      glob: async (pattern, cwd, options) =>
        ripgrepFiles(pattern, await confineToRoot(root, cwd, await extraRoots()), options),
    },
    ls: {
      exists,
      stat: async (target) => stat(await confineToRoot(root, target, await extraRoots())),
      readdir: async (target) => readdir(await confineToRoot(root, target, await extraRoots())),
    },
  };
}
