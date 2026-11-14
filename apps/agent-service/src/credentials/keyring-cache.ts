import type { KeyringStatus } from './keyring.js';

const STATUS_CACHE_TTL_MS = 30_000;

let testMode = false;
let gateTail: Promise<void> = Promise.resolve();

export const secretCache = new Map<string, string>();
export const inflightGets = new Map<string, Promise<string | undefined>>();
export const inflightStatus = new Map<string, Promise<KeyringStatus>>();
export const statusCache = new Map<string, { status: KeyringStatus; expiresAt: number }>();

/**
 * Resets all in-process caches and switches test mode. Test mode disables persistent secret and
 * status caches only when an explicit test keyring module is installed, so tests mutating memory
 * state out-of-band never read stale cached values.
 */
export function resetKeyringCache(isTestModule: boolean): void {
  testMode = isTestModule;
  secretCache.clear();
  inflightGets.clear();
  inflightStatus.clear();
  statusCache.clear();
}

export function isTestMode(): boolean {
  return testMode;
}

export function hasCachedSecret(key: string): boolean {
  return secretCache.has(key);
}

export function getCachedSecret(key: string): string | undefined {
  return secretCache.get(key);
}

/** Returns a non-expired cached availability probe when persistent caching is enabled. */
export function getCachedStatus(service: string): KeyringStatus | undefined {
  if (testMode) return undefined;
  const cached = statusCache.get(service);
  if (!cached) return undefined;
  if (cached.expiresAt > Date.now()) return cached.status;
  statusCache.delete(service);
  return undefined;
}

/** Stores an availability probe result with a short TTL when persistent caching is enabled. */
export function cacheStatus(service: string, status: KeyringStatus): void {
  if (testMode) return;
  statusCache.set(service, { status, expiresAt: Date.now() + STATUS_CACHE_TTL_MS });
}

/** Invalidates any cached or in-flight read state for `key` before a write or delete. */
export function invalidateSecretCache(key: string): void {
  inflightGets.delete(key);
  secretCache.delete(key);
}

/** Deduplicates and caches `status()` probes when no AbortSignal is supplied. */
export async function runCachedStatus(
  service: string,
  signal: AbortSignal | undefined,
  probe: () => Promise<KeyringStatus>,
): Promise<KeyringStatus> {
  if (!signal) {
    const cached = getCachedStatus(service);
    if (cached) return cached;
  }
  const execute = async (): Promise<KeyringStatus> => {
    const result = await probe();
    if (!signal) cacheStatus(service, result);
    return result;
  };
  return signal ? execute() : dedupeInflight(inflightStatus, service, execute);
}

/** Coalesces concurrent callers on `key` while removing the entry only if it is still ours. */
export function dedupeInflight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const pending = run().finally(() => {
    if (map.get(key) === pending) map.delete(key);
  });
  map.set(key, pending);
  return pending;
}

/**
 * Process-wide FIFO queue serializing all native `@napi-rs/keyring` calls so macOS SecurityAgent
 * never stacks concurrent dialogs. A rejected operation leaves the queue intact for later callers.
 */
export function withKeyringGate<T>(op: () => Promise<T>): Promise<T> {
  const run = gateTail.then(op, op);
  gateTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
