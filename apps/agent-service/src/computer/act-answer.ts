import type { ComputerFact } from '@atd/agent-contracts';
import { holdGuidance, holdsBusiness, personCheck } from './policy.js';
import { refusalGuidance, restoredGuidance } from './refusals.js';
import type { ImportedDownload } from './transfers.js';

/*
 * What the model reads in answer to an `act` (act.ts): the action's fact, the earlier actions its
 * check resolved or left unresolved, the downloads it imported as task files (or could not) and
 * what to do next. Besides a refusal or a disturbance the host repaired without stopping the
 * action (refusals.ts), a no-input targeting refusal or an unconfirmed action,
 * `next` explains the hold of a free run (policy.ts) when the action's own outcome sets it and
 * when a check leaves actions it named unresolved, so the model neither repeats an effect that may
 * have run nor stops without the person's check that ends the hold.
 */

/** What an answer reports besides the action's own fact. */
export interface ActAnswer {
  /** Whether the run acts freely, where the hold and `resolves` apply (policy.ts). */
  free: boolean;
  /**
   * Whether the request let the host fall back to the foreground (foreground.ts), where a
   * disturbance it repaired without stopping the action does not stop the task either.
   */
  foreground: boolean;
  /** Whether the call repeated an action id of this run, so nothing was sent again. */
  repeated?: boolean;
  /** Earlier actions the action's verified check resolved. */
  resolved?: readonly string[];
  /** Earlier actions its `resolves` named that remain unresolved after it. */
  unresolved?: readonly string[];
  /** The downloads it imported as task files, and those it could not. */
  files?: { downloads: readonly ImportedDownload[]; notImported: readonly string[] } | null;
  /**
   * The observation read after it, or that none is available, and what to do (`next`) after a
   * targeting refusal, wait timeout or observation read after its unmet postcondition, as
   * next-observation.ts reports them.
   */
  observation?: { next?: string; [field: string]: unknown };
}

/** After a submit or invoke whose outcome now holds its target (`holdsBusiness`). */
function unconfirmedGuidance(fact: ComputerFact): string {
  return `This ${fact.effect} may have taken effect, but its outcome is unconfirmed: never repeat it, and no new submit or invoke runs on this target until it is resolved. ${holdGuidance([fact])}`;
}

/**
 * After a check that left actions it named unresolved, whether its condition did not hold or the
 * check could not run (its error says why, and what to do comes first).
 */
const UNRESOLVED_GUIDANCE = `The actions in unresolved stay unconfirmed: this check did not verify their original postcondition now. Never repeat a submit or invoke among them. If the check could not run, run it again once its cause is gone; if their condition does not hold although the target visibly shows the intended outcome, ${personCheck("that action's step")}; otherwise tell the person what happened.`;

/**
 * The answer's text; a refusal's guidance, or what to do after a disturbance the host repaired
 * without stopping the action, comes first in `next`.
 */
export function answerText(fact: ComputerFact, answer: ActAnswer): string {
  const { resolved = [], unresolved = [], files, observation = {} } = answer;
  const { next: recovery, ...observed } = observation;
  const { result } = fact;
  const next = [
    result?.error ? refusalGuidance(result.error) : null,
    result && answer.foreground ? restoredGuidance(result) : null,
    recovery,
    answer.free && holdsBusiness(fact) ? unconfirmedGuidance(fact) : null,
    unresolved.length ? UNRESOLVED_GUIDANCE : null,
  ].filter((part) => typeof part === 'string');
  const base = {
    ...observed,
    ...(next.length ? { next: next.join(' ') } : {}),
    actionId: fact.actionId,
    effect: fact.effect,
    phase: fact.phase,
    ...(resolved.length ? { resolved } : {}),
    ...(unresolved.length ? { unresolved } : {}),
    ...(files?.downloads.length ? { downloads: files.downloads } : {}),
    ...(files?.notImported.length ? { downloadsNotImported: files.notImported } : {}),
    ...(answer.repeated ? { repeated: true } : {}),
  };
  if (result) return JSON.stringify({ ...base, result });
  return JSON.stringify({
    ...base,
    outcome: 'unknown',
    note: 'The action was sent but no result came back. Do not repeat it; check it later with status.',
  });
}
