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
 * agent catalogs (`~/.atd/skills`, `~/.atd/agents`) via `os.homedir()`. Every
 * other path outside the data directory stays blocked.
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
  if (inside(dataDir, real)) return { real, location: 'outside' };
  const skillsRoot = await resolveRoot(path.join(homedir(), '.atd', 'skills'));
  const agentsRoot = await resolveRoot(path.join(homedir(), '.atd', 'agents'));
  if (inside(skillsRoot, real) || inside(agentsRoot, real)) {
    return { real, location: 'outside' };
  }
  throw new Error('File access outside the service data directory is blocked.');
}

async function resolveRoot(root: string): Promise<string> {
  try {
    return await realpath(root);
  } catch {
    return path.resolve(root);
  }
}
