import {
  COMPUTER_BROWSER_ADDON,
  COMPUTER_ENGINE_FOR_KIND,
  type Automation,
  type AutomationComputerPolicy,
  type AutomationRunReason,
  type ComputerEngine,
  type ComputerGrantRef,
  type RunComputer,
} from '@atd/agent-contracts';
import { commandFingerprint } from '../commands/fingerprint.js';
import { findCommand } from './checks.js';
import type { AutomationComputer, ComputerBindingSource } from './computer-deps.js';
import { definitionHash, engineProfilesHash, grantProblem, runGrantOf } from './computer-grant.js';
import type { AutomationState } from './files.js';
import type { Settlement } from './records.js';

/**
 * Plan §7.2 for a computer automation's fire: the receipt freezes what the grant approved (the
 * definition hash, the grant and the command fingerprint) in the same store change that records
 * the fire; the dequeue compares that with the live automation and never silently runs newer
 * content; the launch checks the grant, the hold, the bindings and the host's engines once more
 * and freezes the grant onto the run, where the computer module checks it live per step. A hold,
 * a chain carrying unresolved effects or a grant that no longer covers the automation turns the
 * fire into a skip (Run now: a 409). Automations without a computer scope are untouched.
 */

/** What a computer fire froze at its receipt. */
export interface FrozenComputer {
  definitionHash: string;
  grant: ComputerGrantRef;
  commandFingerprint?: string;
}

export type FireDecision =
  | { blocked: Extract<AutomationRunReason, 'computerHold' | 'computerGrantInvalid'> }
  | { frozen?: FrozenComputer };

/** The fingerprint of the command a computer automation runs, read before its receipt. */
export async function fireFingerprint(
  automation: Automation,
  dataDir: string,
): Promise<string | undefined> {
  if (!automation.policy.computer || automation.action.kind !== 'command') return undefined;
  const command = await findCommand(dataDir, automation.action.commandId);
  return command ? commandFingerprint(command) : undefined;
}

/**
 * Inside the receipt's store change. `fingerprint`: the command's (`fireFingerprint`);
 * `upstreamUnresolved`: a chained fire's upstream run left computer effects unresolved.
 */
export function decideFire(
  automation: Automation,
  state: AutomationState | undefined,
  computer: AutomationComputer | undefined,
  fingerprint: string | undefined,
  upstreamUnresolved: boolean,
): FireDecision {
  if (!automation.policy.computer) return {};
  if (state?.computerHold || upstreamUnresolved) return { blocked: 'computerHold' };
  const grant = automation.computerGrant;
  if (!computer || !grant || grantProblem(automation, computer.bindings))
    return { blocked: 'computerGrantInvalid' };
  if (grant.commandFingerprint !== fingerprint) return { blocked: 'computerGrantInvalid' };
  return {
    frozen: {
      definitionHash: grant.definitionHash,
      grant: { grantId: grant.grantId, version: grant.version },
      ...(fingerprint ? { commandFingerprint: fingerprint } : {}),
    },
  };
}

/** The 409 Run now answers when a fire is blocked. */
export function blockedMessage(reason: 'computerHold' | 'computerGrantInvalid'): string {
  return reason === 'computerHold'
    ? 'Earlier computer actions are unresolved. Review that run and resolve the hold first.'
    : 'Its computer actions are not authorized as it is saved. Run a trial and authorize it again.';
}

/** How a dequeued fire settles when its automation is no longer what the receipt froze. */
export const CHANGED_SINCE_FIRE: Settlement = {
  outcome: 'needsAttention',
  reason: 'computerGrantInvalid',
  detail: 'The automation or its computer authorization changed after this run fired.',
};

/** Whether the live automation is still what the fire froze (both ways: a scope added counts). */
export function stillFrozen(automation: Automation, frozen: FrozenComputer | undefined): boolean {
  if (!automation.policy.computer) return frozen === undefined;
  const grant = automation.computerGrant;
  return (
    frozen !== undefined &&
    grant !== undefined &&
    definitionHash(automation) === frozen.definitionHash &&
    grant.grantId === frozen.grant.grantId &&
    grant.version === frozen.grant.version
  );
}

export type Preflight =
  | { ok: true; computer?: RunComputer }
  | {
      ok: false;
      reason: Extract<
        AutomationRunReason,
        'computerHold' | 'computerGrantInvalid' | 'computerTargetUnavailable'
      >;
      message: string;
    };

/** The launch's last check before a computer run is submitted, and what the run freezes. */
export function computerPreflight(
  automation: Automation,
  computer: AutomationComputer | undefined,
  held: boolean,
  frozen: FrozenComputer | undefined,
): Preflight {
  const policy = automation.policy.computer;
  if (!policy) return { ok: true };
  if (held) return { ok: false, reason: 'computerHold', message: blockedMessage('computerHold') };
  const invalid = (message: string): Preflight => ({
    ok: false,
    reason: 'computerGrantInvalid',
    message,
  });
  if (!computer || !stillFrozen(automation, frozen) || grantProblem(automation, computer.bindings))
    return invalid(blockedMessage('computerGrantInvalid'));
  const missing = computer.missingAddons(neededEngines(policy, computer.bindings));
  if (missing.length)
    return {
      ok: false,
      reason: 'computerTargetUnavailable',
      message: missingAddonsMessage(missing),
    };
  const engines = engineProfilesHash(policy, computer.bindings, computer.profiles());
  if (!engines)
    return {
      ok: false,
      reason: 'computerTargetUnavailable',
      message: 'The computer host is not running, or cannot act on these targets unattended.',
    };
  if (engines !== automation.computerGrant?.trialRef.engineProfilesHash)
    return invalid('The computer engines changed since the trial. Run a trial and authorize it.');
  return { ok: true, computer: { bindingIds: policy.bindingIds, grant: runGrantOf(automation) } };
}

/** The engines the policy's registered targets run on, each once. */
function neededEngines(
  policy: AutomationComputerPolicy,
  bindings: ComputerBindingSource,
): ComputerEngine[] {
  const kinds = policy.bindingIds.flatMap((id) => bindings.get(id)?.kind ?? []);
  return [...new Set(kinds.map((kind) => COMPUTER_ENGINE_FOR_KIND[kind]))];
}

/**
 * The engine each computer add-on provides, as Settings → Computer use names it. Apps run on the
 * built-in engine, which no add-on provides.
 */
const ENGINE_NAMES: Readonly<Record<string, string>> = {
  [COMPUTER_BROWSER_ADDON]: 'browser engine',
};

/** Why a computer run cannot start without its engines' add-ons, naming them. */
function missingAddonsMessage(ids: readonly string[]): string {
  const names = ids.map((id) => `the ${ENGINE_NAMES[id] ?? `"${id}" add-on`}`).join(' and ');
  const [verb, them] = ids.length === 1 ? ['is', 'it'] : ['are', 'them'];
  return `Computer use needs ${names}, which ${verb} not installed. Install ${them} in Settings → Computer use → Engines.`;
}
