import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FindOperations, GrepOperations, LsOperations } from '@earendil-works/pi-coding-agent';
import { inside, resolveToolPath } from '../../service-fs.js';
import { ripgrepFiles } from './ripgrep.js';

/** Thrown before the gate when a grep/find/ls path leaves the task folder. */
export const OUTSIDE_TASK_FOLDER = 'File access outside the task folder is blocked.';

/**
 * Real path of `target`, required to lie inside the real `root`. A missing path resolves through
 * its nearest existing ancestor, so a missing name under a symlink that leads outside still
 * counts as outside.
 */
export async function confineToRoot(root: string, target: string): Promise<string> {
  const realRoot = await realOrNearest(path.resolve(root));
  const real = await realOrNearest(path.resolve(root, target));
  if (!inside(realRoot, real)) throw new Error(OUTSIDE_TASK_FOLDER);
  return real;
}

/**
 * Confines a grep/find/ls `path` argument (default: the task folder) as pi resolves it: `@`,
 * `~` and `file://` spellings resolve like pi's tools before the containment check.
 */
export function confineToolArgument(root: string, rawPath: string | undefined): Promise<string> {
  return confineToRoot(root, resolveToolPath(root, rawPath || '.'));
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
 * pi's pluggable grep/find/ls operations, each confined to `root`. They are the second line of
 * confinement after the argument check: every path pi touches (search roots, context-line file
 * reads, listed entries) must stay inside the task folder. find globs through ripgrep, never
 * through pi's fd download path.
 */
export function searchOperations(root: string): {
  grep: GrepOperations;
  find: FindOperations;
  ls: LsOperations;
} {
  const exists = async (target: string) => {
    const real = await confineToRoot(root, target);
    try {
      await stat(real);
      return true;
    } catch {
      return false;
    }
  };
  return {
    grep: {
      isDirectory: async (target) => (await stat(await confineToRoot(root, target))).isDirectory(),
      readFile: async (target) => readFile(await confineToRoot(root, target), 'utf8'),
    },
    find: {
      exists,
      glob: async (pattern, cwd, options) =>
        ripgrepFiles(pattern, await confineToRoot(root, cwd), options),
    },
    ls: {
      exists,
      stat: async (target) => stat(await confineToRoot(root, target)),
      readdir: async (target) => readdir(await confineToRoot(root, target)),
    },
  };
}
