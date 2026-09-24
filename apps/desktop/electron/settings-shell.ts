import { putShellAllowlist } from '@ai/agent-client';
import { normalizeShellAllowlistEntry, SHELL_ALLOWLIST_MAX_ENTRIES } from '@ai/agent-contracts';
import type { ServiceConnection } from './service/connection';

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

/**
 * Keeps the agent service's in-memory user allowlist equal to the saved one. The service starts
 * empty, so the full list is pushed on every transition to connected and after every change.
 * Pushes run one at a time and each sends the list current at send time, so an older list never
 * overwrites a newer one. A failed push is logged and repaired by the next connection or change.
 */
export class ShellAllowlistSync {
  private connection: ServiceConnection | null = null;
  private chain: Promise<void> = Promise.resolve();
  private queued = false;

  constructor(private readonly entries: () => readonly string[]) {}

  attach(connection: ServiceConnection) {
    this.connection = connection;
    connection.onConnected(() => this.push());
    this.push();
  }

  /** Schedules a push of the current list; at most one push waits behind a running one. */
  push() {
    if (this.queued) return;
    this.queued = true;
    this.chain = this.chain.then(async () => {
      this.queued = false;
      await this.send();
    });
  }

  private async send(): Promise<void> {
    // Disconnected: nothing to update; the next connection pushes the list.
    const options = this.connection?.options();
    if (!options) return;
    try {
      await putShellAllowlist(options, [...this.entries()]);
    } catch (error) {
      console.warn(
        'Could not send the shell allowlist to the agent service; it is sent again on the next connection:',
        error,
      );
    }
  }
}
