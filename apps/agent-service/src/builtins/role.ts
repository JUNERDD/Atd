import type { RoleRecord, RolesFile } from '../skills/roles.js';
import { roleFingerprint } from './fingerprint.js';
import {
  DEFAULT_ROLE_BUILTIN,
  builtinStatus,
  reconcileAction,
  type BuiltinStatus,
} from './manifest.js';
import type { InstallRecord } from './state.js';

/**
 * The builtin default role as this build ships it. Snapshot tools only (at most 16 per role);
 * parent-only harness tools are not role-granted. An empty skill list allows every skill.
 */
const SHIPPED = {
  title: 'Default service role',
  allows: { tools: ['read', 'write', 'edit', 'bash', 'command', 'grep', 'find', 'ls'], skills: [] },
} as const;

export const SHIPPED_ROLE_FINGERPRINT = roleFingerprint(SHIPPED);

/**
 * The shipped default role record. Its revision names the builtin version, so runs frozen on
 * another version stay distinguishable in role-runs.json.
 */
export function shippedDefaultRole(updatedAt = new Date(0).toISOString()): RoleRecord {
  return {
    id: DEFAULT_ROLE_BUILTIN.name,
    revision: `rev-builtin-default-v${DEFAULT_ROLE_BUILTIN.version}`,
    title: SHIPPED.title,
    allows: { tools: [...SHIPPED.allows.tools], skills: [...SHIPPED.allows.skills] },
    updatedAt,
  };
}

/** What reconciling the default role in a roles file does. */
export interface RoleReconcile {
  file: RolesFile;
  /** The roles file changed and must be written. */
  write: boolean;
  /** The shipped version must be recorded as installed. */
  record: boolean;
  /** Fingerprint of the default role in `file`. */
  fingerprint: string;
}

/**
 * Reconciles the default role inside a roles file (null when there is none yet) against its
 * install record, by `reconcileAction`: a missing role is installed, an untouched one (the
 * recorded fingerprint, or without a record one in the shipped history) is replaced by the shipped
 * role, and a changed one is kept.
 */
export function reconcileDefaultRole(
  stored: RolesFile | null,
  recorded: InstallRecord | undefined,
): RoleReconcile {
  const file = stored ?? { version: 1, roles: [], defaultRoleId: DEFAULT_ROLE_BUILTIN.name };
  const current = file.roles.find((role) => role.id === DEFAULT_ROLE_BUILTIN.name);
  const copy = current ? roleFingerprint(current) : null;
  const action = reconcileAction(DEFAULT_ROLE_BUILTIN, copy, SHIPPED_ROLE_FINGERPRINT, recorded);
  if (action === 'install' || copy === null)
    return {
      file: placeDefaultRole(file, shippedDefaultRole(new Date().toISOString())),
      write: true,
      record: true,
      fingerprint: SHIPPED_ROLE_FINGERPRINT,
    };
  return { file, write: false, record: action === 'record', fingerprint: copy };
}

/** Status of a default role with `fingerprint`, against its install record. */
export function defaultRoleStatus(
  fingerprint: string,
  record: InstallRecord | undefined,
): BuiltinStatus {
  return builtinStatus(DEFAULT_ROLE_BUILTIN, fingerprint, SHIPPED_ROLE_FINGERPRINT, record);
}

/** The roles file with `role` as its default role, replacing the stored one in place. */
export function placeDefaultRole(file: RolesFile, role: RoleRecord): RolesFile {
  const at = file.roles.findIndex((item) => item.id === role.id);
  const roles =
    at === -1
      ? [...file.roles, role]
      : file.roles.map((item, index) => (index === at ? role : item));
  return { ...file, roles };
}
