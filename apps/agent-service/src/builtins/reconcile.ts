import type { BuiltinEntry, BuiltinState, BuiltinStatus } from './manifest.js';
import type { InstallRecord } from './state.js';

/**
 * What reconciling one builtin resource does with the copy in the user's location, by the upgrade
 * rules builtins/manifest.ts describes: the shipped content and versions come from the manifest,
 * the copy's fingerprint and install record from the caller (builtins/skills.ts, builtins/role.ts).
 */

/** What reconciling one resource does. */
export type ReconcileAction = 'install' | 'record' | 'keep' | 'none';

/**
 * Decides what reconciling a copy does. Absent → install. Equal to the shipped content → record
 * it. Unmodified since the recorded install, or (without a record) equal to a shipped version →
 * install the shipped version over it. Anything else is the user's → keep it, and leave it to
 * the caller to replace an outdated one (see builtins/manifest.ts).
 */
export function reconcileAction(
  entry: BuiltinEntry,
  copy: string | null,
  latest: string,
  recorded: InstallRecord | undefined,
): ReconcileAction {
  if (copy === null) return 'install';
  if (copy === latest)
    return recorded?.fingerprint === latest && recorded.version === entry.version
      ? 'none'
      : 'record';
  const unmodified = recorded ? copy === recorded.fingerprint : entry.history.includes(copy);
  return unmodified ? 'install' : 'keep';
}

/**
 * Status of a copy after reconciling: `current` when it holds the shipped content; otherwise the
 * user changed it. When the user edited the content this build ships (its recorded base is the
 * shipped fingerprint) that is `modified`; when the shipped content differs from their base (or
 * there is no record) it is `update_available`. Comparing fingerprints, not `version`, keeps the
 * status right even when shipped content changes without a version bump.
 */
export function builtinStatus(
  entry: BuiltinEntry,
  copy: string,
  latest: string,
  recorded: InstallRecord | undefined,
): BuiltinStatus {
  const status: BuiltinState =
    copy === latest
      ? 'current'
      : recorded?.fingerprint !== latest
        ? 'update_available'
        : 'modified';
  const backupPath = recorded?.backupPath;
  return { id: entry.id, version: entry.version, status, ...(backupPath ? { backupPath } : {}) };
}
