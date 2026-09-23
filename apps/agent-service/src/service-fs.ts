import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';

/** Operator shell allowlist; empty denies every command with a clear message. */
export function shellAllowlist(): string[] {
  return (process.env.AI_AGENT_SHELL_ALLOWLIST ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export interface ConfinedPath {
  real: string;
  location: 'inside' | 'outside';
}

/**
 * Confines a tool path to the service dataDir, reporting whether it lands in
 * the task output dir. Also allows real paths under the product home skill and
 * agent catalogs (`~/.atd/skills`, `~/.atd/agents`) via `os.homedir()`, and
 * under `readRoots`, which only the read tool passes: the directories of the
 * skills the current run loaded. Every other path outside the data directory
 * stays blocked.
 */
export async function confined(
  cwd: string,
  dataDir: string,
  rawPath: string,
  readRoots: readonly string[] = [],
): Promise<ConfinedPath> {
  const real = await realTarget(cwd, rawPath);
  if (inside(cwd, real)) return { real, location: 'inside' };
  if (inside(dataDir, real)) return { real, location: 'outside' };
  const home = homedir();
  const roots = [
    path.join(home, '.atd', 'skills'),
    path.join(home, '.atd', 'agents'),
    ...readRoots,
  ];
  if (await underAny(roots, real)) return { real, location: 'outside' };
  throw new Error('File access outside the service data directory is blocked.');
}

/**
 * Whether a tool path lies under one of `roots`. Both sides compare as real
 * paths, so a symlink inside a root that leads elsewhere does not count.
 */
export async function withinRoots(
  roots: readonly string[],
  cwd: string,
  rawPath: string,
): Promise<boolean> {
  return underAny(roots, await realTarget(cwd, rawPath));
}

async function realTarget(cwd: string, rawPath: string): Promise<string> {
  const absolute = path.resolve(cwd, rawPath);
  try {
    return await realpath(absolute);
  } catch {
    // A missing path (a file about to be written) keeps its resolved form.
    return absolute;
  }
}

async function underAny(roots: readonly string[], real: string): Promise<boolean> {
  for (const root of roots) if (inside(await resolveRoot(root), real)) return true;
  return false;
}

async function resolveRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    return path.resolve(root);
  }
}
