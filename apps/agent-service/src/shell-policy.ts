import {
  isShellAllowlisted,
  normalizeShellAllowlistEntry,
  suggestShellAllowlistEntry,
  tierAllows,
  type GrantScope,
  type PermissionTier,
} from '@ai/agent-contracts';
import type { Gate } from './harness/gate.js';
import type { Logger } from './logging.js';

/**
 * The service's one shell policy: which bash commands run without a confirm. The effective list
 * is the operator list (`AI_AGENT_SHELL_ALLOWLIST`, comma separated) united with the user list
 * the desktop pushes through `PUT /v1/settings/shell-allowlist`. Matching is the contract's
 * `isShellAllowlisted` (token boundaries; commands with shell control characters never match).
 *
 * The parent's bash tool and every subagent child's bash tool decide through
 * `authorizeShellCommand`, each with its own gate (a child's gate is the parent's, attributed to
 * the child's execution). Pi loads the child
 * bridge through its own module loader, so the state lives on `globalThis` under a versioned
 * symbol (like subagents/registry.ts): both module instances then read the same user list.
 */

/** Returned to the model when the user declines a shell command at the confirm. */
export const SHELL_DECLINED_MESSAGE =
  'The user denied this shell command. It is not on the shell allowlist; do not retry it, ask the user or choose another approach.';

const ENV_KEY = 'AI_AGENT_SHELL_ALLOWLIST';

interface ShellPolicyState {
  /** User entries in the order main pushed them; empty until the first push. */
  user: string[];
  /** Raw env value the cached operator list was parsed from. */
  envRaw: string | undefined;
  env: string[];
  invalidEnv: string[];
}

const STORE_KEY = Symbol.for('ai.agent-service.shell-policy.v1');

function state(): ShellPolicyState {
  const global = globalThis as Record<symbol, ShellPolicyState | undefined>;
  const existing = global[STORE_KEY];
  if (existing) return existing;
  const created: ShellPolicyState = { user: [], envRaw: undefined, env: [], invalidEnv: [] };
  global[STORE_KEY] = created;
  return created;
}

/** Operator entries from the env, normalized like user entries; invalid ones are dropped. */
function operatorEntries(): string[] {
  const current = state();
  const raw = process.env[ENV_KEY];
  if (raw === current.envRaw) return current.env;
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const item of (raw ?? '').split(',')) {
    if (!item.trim()) continue;
    const result = normalizeShellAllowlistEntry(item);
    if ('entry' in result) valid.push(result.entry);
    else invalid.push(item.trim().slice(0, 80));
  }
  current.envRaw = raw;
  current.env = [...new Set(valid)];
  current.invalidEnv = invalid;
  return current.env;
}

/**
 * Logs the operator entries the policy drops. The service calls it once at startup; entries are
 * clipped, and the env list is operator configuration, not a secret.
 */
export function warnInvalidOperatorShellEntries(log: Logger): void {
  operatorEntries();
  for (const entry of state().invalidEnv)
    log.warn('Ignoring an invalid AI_AGENT_SHELL_ALLOWLIST entry.', { entry });
}

/**
 * Replaces the user list. Callers pass entries already validated against the contract schema;
 * they are normalized again so matching never depends on the caller's spelling.
 */
export function setUserShellAllowlist(entries: readonly string[]): string[] {
  const normalized = entries.flatMap((value) => {
    const result = normalizeShellAllowlistEntry(value);
    return 'entry' in result ? [result.entry] : [];
  });
  state().user = [...new Set(normalized)];
  return [...state().user];
}

export function userShellAllowlist(): string[] {
  return [...state().user];
}

/** Whether `command` runs without a confirm under operator ∪ user entries. */
export function isCommandAllowlisted(command: string): boolean {
  return isShellAllowlisted([...operatorEntries(), ...state().user], command);
}

const BASH_SCOPE: GrantScope = { tool: 'bash' };

export interface ShellDecision {
  command: string;
  toolCallId: string;
  tier: PermissionTier;
  gate: Gate;
  signal?: AbortSignal;
  /** What the confirm shows as approved (the call's arguments). */
  detail: string;
  /** Audits a run the allowlist allowed without a confirm. */
  auditAllowlisted: () => void;
}

/**
 * The one bash decision, for parent and children: a tier that allows bash runs it (the gate
 * audits `tier`); otherwise an allowlisted command runs without a confirm; anything else asks
 * once. Bash never takes a session grant, so every other command is confirmed on its own, with
 * the suggested allowlist entry the confirm can offer to add. Throws when the user declines.
 */
export async function authorizeShellCommand(decision: ShellDecision): Promise<void> {
  const command = decision.command.trim();
  if (!tierAllows(decision.tier, BASH_SCOPE) && isCommandAllowlisted(command)) {
    decision.auditAllowlisted();
    return;
  }
  await decision.gate({
    toolCallId: decision.toolCallId,
    scope: BASH_SCOPE,
    title: `Run: ${command.slice(0, 200)}`,
    detail: decision.detail,
    signal: decision.signal,
    sessionGrant: false,
    allowlistEntry: suggestShellAllowlistEntry(command) ?? undefined,
    declinedMessage: SHELL_DECLINED_MESSAGE,
  });
}
