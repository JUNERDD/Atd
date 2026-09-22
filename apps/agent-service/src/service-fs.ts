import path from 'node:path';
import { realpath } from 'node:fs/promises';

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
 * the task output dir. Paths outside the dataDir are blocked, never confirmed.
 */
export async function confined(
  cwd: string,
  dataDir: string,
  rawPath: string,
): Promise<ConfinedPath> {
  const absolute = path.resolve(cwd, rawPath);
  let real = absolute;
  try {
    real = await realpath(absolute);
  } catch {
    // Missing paths resolve against the closest existing parent.
    real = absolute;
  }
  if (inside(cwd, real)) return { real, location: 'inside' };
  if (!inside(dataDir, real))
    throw new Error('File access outside the service data directory is blocked.');
  return { real, location: 'outside' };
}
