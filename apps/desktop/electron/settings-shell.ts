import { normalizeShellAllowlistEntry, SHELL_ALLOWLIST_MAX_ENTRIES } from '@ai/agent-contracts';

/**
 * Reads the saved user shell allowlist leniently: a missing or malformed field becomes `[]`, and
 * entries that no longer normalize, repeat an earlier entry or exceed the cap are dropped, so a
 * stale or hand-edited list never makes the whole settings file unreadable.
 */
export function parseStoredShellAllowlist(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const result = normalizeShellAllowlistEntry(item);
    if ('entry' in result && !entries.includes(result.entry)) entries.push(result.entry);
    if (entries.length === SHELL_ALLOWLIST_MAX_ENTRIES) break;
  }
  return entries;
}

/**
 * Validates one entry from an IPC payload. The renderer pre-validates to show the specific error
 * code, so main rejects generically.
 */
export function parseShellAllowlistEntry(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Invalid shell allowlist entry.');
  const result = normalizeShellAllowlistEntry(value);
  if (!('entry' in result)) throw new TypeError('Invalid shell allowlist entry.');
  return result.entry;
}

/** Validates a full-replace payload: every entry valid, no duplicates after normalizing, capped. */
export function parseShellAllowlist(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > SHELL_ALLOWLIST_MAX_ENTRIES)
    throw new TypeError('Invalid shell allowlist.');
  const entries = value.map(parseShellAllowlistEntry);
  if (new Set(entries).size !== entries.length) throw new TypeError('Invalid shell allowlist.');
  return entries;
}

/** The list after adding `entry`; an entry already listed leaves the same array. */
export function withShellAllowlistEntry(entries: string[], entry: string): string[] {
  if (entries.includes(entry)) return entries;
  if (entries.length >= SHELL_ALLOWLIST_MAX_ENTRIES)
    throw new TypeError('The shell allowlist is full.');
  return [...entries, entry];
}
