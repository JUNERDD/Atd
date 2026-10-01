import { randomBytes } from 'node:crypto';
import { KeyringBackend, LAUNCH_APPROVAL_KEY_ACCOUNT } from '../credentials/keyring.js';

/**
 * The profile's launch approval key: 32 random bytes in the OS keyring (never the data dir), so a
 * process that can write the data dir still cannot mint a fingerprint that matches. A key once
 * read or created is kept for the process; without the keyring no approval can be verified, and
 * every launch that needs one is refused.
 */

const KEY_BYTES = 32;
const known = new Map<string, Buffer>();
const creating = new Map<string, Promise<Buffer>>();

/** The key, or null when none exists yet (nothing was ever approved under this profile). */
export async function readLaunchKey(serviceId: string): Promise<Buffer | null> {
  const cached = known.get(serviceId);
  if (cached) return cached;
  const stored = await new KeyringBackend(serviceId).get(LAUNCH_APPROVAL_KEY_ACCOUNT);
  if (stored === undefined) return null;
  const key = Buffer.from(stored, 'base64');
  if (key.length !== KEY_BYTES) throw new Error('The stored launch approval key is malformed.');
  known.set(serviceId, key);
  return key;
}

/** The key, created on first use; concurrent callers share one creation. */
export function launchKey(serviceId: string): Promise<Buffer> {
  const pending = creating.get(serviceId);
  if (pending) return pending;
  const created = (async () => {
    const existing = await readLaunchKey(serviceId);
    if (existing) return existing;
    const key = randomBytes(KEY_BYTES);
    await new KeyringBackend(serviceId).set(LAUNCH_APPROVAL_KEY_ACCOUNT, key.toString('base64'));
    known.set(serviceId, key);
    return key;
  })();
  creating.set(serviceId, created);
  void created.finally(() => creating.delete(serviceId)).catch(() => undefined);
  return created;
}
