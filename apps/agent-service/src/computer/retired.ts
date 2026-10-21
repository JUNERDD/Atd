import { currentComputerErrorCode } from '@atd/agent-contracts';

/*
 * Read-side tolerance for computer data written before computer protocol 8
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §10.2). Protocol 8 retired the run's
 * computer `mode`, the `delivery` of grant scopes and the takeover error codes; those stay
 * retired. A `foreground` delivery on an action result or transcript details is current again
 * since protocol 9 (docs/plans/2026-10-21-foreground-fallback.md R9), so it reads as written.
 * Readers of stored data pass a value through these before their own schema check, so a record
 * written then still loads with the meaning it has today; nothing here rewrites a file, writes
 * stay strict, and anything else is left for that schema check to judge.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored error whose retired code maps to its replacement (`currentComputerErrorCode`). */
function currentError(error: unknown): unknown {
  return isRecord(error) && typeof error.code === 'string'
    ? { ...error, code: currentComputerErrorCode(error.code) }
    : error;
}

/**
 * A stored action result as it reads today: a retired error code maps to its replacement, so an
 * unresolved action stays unresolved instead of failing to load.
 */
function currentActionResult(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return 'error' in value ? { ...value, error: currentError(value.error) } : value;
}

/** A stored computer fact (`computer/records/<runId>.jsonl`) as it reads today. */
export function currentFact(value: unknown): unknown {
  return isRecord(value) && 'result' in value
    ? { ...value, result: currentActionResult(value.result) }
    : value;
}

/**
 * Stored transcript details of a `computer` call as they read today: their action result and
 * their operation's `error` both map retired codes. A row of the retired `flow` operation is left
 * as it is, so it stays unknown details the transcript does not show.
 */
export function currentComputerDetails(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    ...('result' in value ? { result: currentActionResult(value.result) } : {}),
    ...('error' in value ? { error: currentError(value.error) } : {}),
  };
}

/** A stored grant scope: computer and computer access scopes carry no `delivery` any more. */
function currentGrantScope(scope: unknown): unknown {
  if (!isRecord(scope) || (scope.tool !== 'computer' && scope.tool !== 'computerAccess'))
    return scope;
  const { delivery: _retired, ...rest } = scope;
  void _retired;
  return rest;
}

/**
 * A stored value that carries a grant scope, as it reads today: a pending confirm in the ledger,
 * or a permission record (`app-permission` session entry) whose outcome the transcript shows.
 */
export function withCurrentScope(value: unknown): unknown {
  return isRecord(value) && 'scope' in value
    ? { ...value, scope: currentGrantScope(value.scope) }
    : value;
}

/** A stored run snapshot: a run's computer use carries no `mode` any more. */
export function currentRunSnapshot(snapshot: unknown): unknown {
  if (!isRecord(snapshot) || !isRecord(snapshot.computer)) return snapshot;
  const { mode: _retired, ...computer } = snapshot.computer;
  void _retired;
  return { ...snapshot, computer };
}
