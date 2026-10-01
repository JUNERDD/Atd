import { normalizeShellAllowlistEntry, SHELL_ALLOWLIST_MAX_ENTRIES } from '@ai/agent-contracts';

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
