import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import {
  KeyringBackend,
  keyringServiceName,
  LAUNCH_APPROVAL_KEY_ACCOUNT,
} from '../credentials/keyring.js';
import { getCachedSecret, hasCachedSecret, isTestMode } from '../credentials/keyring-cache.js';

const execFileAsync = promisify(execFile);

/**
 * The profile's launch approval key: 32 random bytes in the OS keyring (never the data dir), so a
 * process that can write the data dir still cannot mint a fingerprint that matches. A key once
 * read or created is kept for the process; without the keyring no approval can be verified, and
 * every launch that needs one is refused.
 */

export type LaunchApprovalKeyState = 'not_created' | 'readable' | 'unreadable' | 'malformed';

const KEY_BYTES = 32;
const known = new Map<string, Buffer>();
const creating = new Map<string, Promise<Buffer>>();
const observedStates = new Map<string, LaunchApprovalKeyState>();

function cacheKey(serviceId: string): string {
  return `${keyringServiceName(serviceId)}\0${LAUNCH_APPROVAL_KEY_ACCOUNT}`;
}

/**
 * Passive, zero-modal getter returning the cached `launchApprovalKeyState` without
 * triggering macOS SecurityAgent dialogs or blocking `withKeyringGate`.
 */
export function launchApprovalKeyState(
  serviceId: string,
  options: { hasSavedApprovals?: boolean | undefined } = {},
): LaunchApprovalKeyState {
  const inMemory = known.get(serviceId);
  if (inMemory) return inMemory.length === KEY_BYTES ? 'readable' : 'malformed';

  const observed = observedStates.get(serviceId);
  if (observed) return observed;

  const key = cacheKey(serviceId);
  if (!isTestMode() && hasCachedSecret(key)) {
    const cached = getCachedSecret(key);
    if (cached === undefined) return 'not_created';
    return Buffer.from(cached, 'base64').length === KEY_BYTES ? 'readable' : 'malformed';
  }

  if (options.hasSavedApprovals === false) return 'not_created';
  return 'not_created';
}

/**
 * Non-interactive probe of the launch approval key outside `withKeyringGate`:
 * - Uses cached state or returns `'not_created'` when no saved approvals exist.
 * - On macOS production keyrings, checks item existence via `security find-generic-password`
 *   without `-w` (never pops SecurityAgent password prompt) with a 300ms timeout.
 * - In test mode (in-memory keyring), reads through the mock backend with a 300ms timeout.
 */
export async function probeLaunchApprovalKeyState(
  serviceId: string,
  options: { hasSavedApprovals?: boolean | undefined; timeoutMs?: number | undefined } = {},
): Promise<LaunchApprovalKeyState> {
  if (known.has(serviceId)) return launchApprovalKeyState(serviceId, options);
  const observed = observedStates.get(serviceId);
  if (observed) return observed;
  if (options.hasSavedApprovals === false) return 'not_created';
  if (!isTestMode() && hasCachedSecret(cacheKey(serviceId))) {
    return launchApprovalKeyState(serviceId, options);
  }

  const timeoutMs = options.timeoutMs ?? 300;
  if (process.platform === 'darwin' && !isTestMode()) {
    try {
      await execFileAsync(
        '/usr/bin/security',
        [
          'find-generic-password',
          '-s',
          keyringServiceName(serviceId),
          '-a',
          LAUNCH_APPROVAL_KEY_ACCOUNT,
        ],
        { timeout: timeoutMs },
      );
      return 'readable';
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      // Exit code 44 from `/usr/bin/security` is errSecItemNotFound.
      if (code === 44) return 'not_created';
      return 'unreadable';
    }
  }

  if (isTestMode()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const existing = await readLaunchKey(serviceId, controller.signal);
      return existing ? 'readable' : 'not_created';
    } catch {
      return observedStates.get(serviceId) ?? 'unreadable';
    } finally {
      clearTimeout(timer);
    }
  }

  return launchApprovalKeyState(serviceId, options);
}

/** Clears in-process launch key caches; intended for unit tests. */
export function __resetLaunchKeyCacheForTests(): void {
  known.clear();
  creating.clear();
  observedStates.clear();
}

/** The key, or null when none exists yet (nothing was ever approved under this profile). */
export async function readLaunchKey(
  serviceId: string,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const cached = known.get(serviceId);
  if (cached) {
    observedStates.set(serviceId, 'readable');
    return cached;
  }
  let stored: string | undefined;
  try {
    stored = await new KeyringBackend(serviceId).get(LAUNCH_APPROVAL_KEY_ACCOUNT, signal);
  } catch (error) {
    observedStates.set(serviceId, 'unreadable');
    throw error;
  }
  if (stored === undefined) {
    observedStates.set(serviceId, 'not_created');
    return null;
  }
  const key = Buffer.from(stored, 'base64');
  if (key.length !== KEY_BYTES) {
    observedStates.set(serviceId, 'malformed');
    throw new Error('The stored launch approval key is malformed.');
  }
  known.set(serviceId, key);
  observedStates.set(serviceId, 'readable');
  return key;
}

/** The key, created on first use; concurrent callers share one creation. */
export function launchKey(serviceId: string): Promise<Buffer> {
  const pending = creating.get(serviceId);
  if (pending) return pending;
  const created = (async () => {
    const existing = await readLaunchKey(serviceId);
    if (existing) return existing;
    return writeNewLaunchKey(serviceId);
  })();
  creating.set(serviceId, created);
  void created.finally(() => creating.delete(serviceId)).catch(() => undefined);
  return created;
}

/** Rotates the launch approval key during explicit user re-approval when the prior key failed. */
export async function rotateLaunchKeyOnApproval(serviceId: string): Promise<Buffer> {
  known.delete(serviceId);
  return writeNewLaunchKey(serviceId);
}

async function writeNewLaunchKey(serviceId: string): Promise<Buffer> {
  const key = randomBytes(KEY_BYTES);
  try {
    await new KeyringBackend(serviceId).set(LAUNCH_APPROVAL_KEY_ACCOUNT, key.toString('base64'));
  } catch (error) {
    observedStates.set(serviceId, 'unreadable');
    throw error;
  }
  known.set(serviceId, key);
  observedStates.set(serviceId, 'readable');
  return key;
}
