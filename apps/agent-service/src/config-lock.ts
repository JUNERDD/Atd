import { execFile } from 'node:child_process';
import { mkdir, readFile, readlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse } from '@atd/agent-contracts';
import { Type, type Static } from 'typebox';
import { scrubPersonalPaths } from './diagnostics/scrub-paths.js';
import type { ServicePaths } from './storage.js';

const execFileAsync = promisify(execFile);

const LockFileSchema = Type.Object(
  {
    version: Type.Literal(1),
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.String(),
    command: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  },
  { additionalProperties: false },
);

export interface ConfigRecoveryState {
  corruptLockRecovered: boolean;
  staleLockReclaimed: boolean;
  serviceFileRecreated: boolean;
  tokenRotated: boolean;
  lastRecoveredAt: string | null;
}

const recoveryState: ConfigRecoveryState = {
  corruptLockRecovered: false,
  staleLockReclaimed: false,
  serviceFileRecreated: false,
  tokenRotated: false,
  lastRecoveredAt: null,
};

/** Returns a readonly snapshot of startup lock/state self-healing actions. */
export function getConfigRecoveryState(): ConfigRecoveryState {
  return { ...recoveryState };
}

/** Resets startup recovery tracking; intended for isolated unit tests. */
export function resetConfigRecoveryStateForTests(): void {
  recoveryState.corruptLockRecovered = false;
  recoveryState.staleLockReclaimed = false;
  recoveryState.serviceFileRecreated = false;
  recoveryState.tokenRotated = false;
  recoveryState.lastRecoveredAt = null;
}

export function noteConfigRecovery(flag: keyof Omit<ConfigRecoveryState, 'lastRecoveredAt'>): void {
  recoveryState[flag] = true;
  recoveryState.lastRecoveredAt = new Date().toISOString();
}

export const isCorruptConfigError = (error: unknown): boolean =>
  error instanceof SyntaxError || error instanceof TypeError;

export const isErrnoCode = (error: unknown, code: string): boolean =>
  error instanceof Error && 'code' in error && error.code === code;

function matchesServiceExecutable(comm: string, expectedCommand?: string): boolean {
  const actual = path.basename(comm.trim()).toLowerCase();
  if (!actual) return false;
  if (expectedCommand) {
    const expected = path.basename(expectedCommand.trim()).toLowerCase();
    return actual === expected || actual.startsWith(expected);
  }
  const ownExec = path.basename(process.execPath).toLowerCase();
  return (
    actual === ownExec ||
    actual === 'node' ||
    actual === 'nodejs' ||
    actual === 'agent-service' ||
    actual.startsWith('node')
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrnoCode(error, 'EPERM');
  }
}

/** Checks both PID liveness and executable identity to guard against same-UID PID reuse. */
export async function isLockHolderAlive(pid: number, expectedCommand?: string): Promise<boolean> {
  if (!isPidAlive(pid)) return false;
  if (process.platform === 'win32') return true;
  try {
    // Linux comm is a mutable, length-limited thread name. The lock records the executable.
    if (process.platform === 'linux') {
      return matchesServiceExecutable(await readlink(`/proc/${pid}/exe`), expectedCommand);
    }
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'comm='], {
      timeout: 1000,
    });
    const comm = stdout.trim();
    return comm ? matchesServiceExecutable(comm, expectedCommand) : isPidAlive(pid);
  } catch {
    // An unreadable executable or failed ps lookup is insufficient to reclaim a live lock.
    return isPidAlive(pid);
  }
}

/** Acquires the dataDir owner lock; recovers corrupt/stale locks and throws when a live owner holds it. */
export async function acquireDataDirLock(
  paths: ServicePaths,
  writeLock: (file: string, value: unknown, mode: number) => Promise<void>,
): Promise<void> {
  await mkdir(path.dirname(paths.lockFile), { recursive: true });
  try {
    const raw = await readFile(paths.lockFile, 'utf8');
    let lock: Static<typeof LockFileSchema> | null = null;
    try {
      lock = parse(LockFileSchema, JSON.parse(raw));
    } catch (parseError) {
      if (!isCorruptConfigError(parseError)) throw parseError;
      noteConfigRecovery('corruptLockRecovered');
    }
    if (lock) {
      if (await isLockHolderAlive(lock.pid, lock.command)) {
        throw new Error(
          `Another agent service (pid ${lock.pid}) owns ${scrubPersonalPaths(paths.root)}.`,
        );
      }
      noteConfigRecovery('staleLockReclaimed');
    }
  } catch (error) {
    if (!isErrnoCode(error, 'ENOENT')) throw error;
  }
  await writeLock(
    paths.lockFile,
    {
      version: 1,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      command: path.basename(process.execPath),
    },
    0o600,
  );
}

export async function releaseDataDirLock(paths: ServicePaths): Promise<void> {
  await rm(paths.lockFile, { force: true });
}
