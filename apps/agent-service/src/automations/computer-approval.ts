import { randomUUID } from 'node:crypto';
import type {
  Automation,
  AutomationComputerApprovalDetails,
  AutomationComputerApproveRequest,
  AutomationDraft,
  ComputerBindingHashes,
  ComputerGrant,
  ComputerTrial,
  TargetBinding,
} from '@atd/agent-contracts';
import { commandFingerprint } from '../commands/fingerprint.js';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { problemError, type Lookups } from './checks.js';
import type { AutomationComputer } from './computer-deps.js';
import {
  definitionHash,
  engineProfilesHash,
  liveBindingHashes,
  recipeHash,
  sha256Of,
} from './computer-grant.js';
import type { ComputerTrials } from './computer-trials.js';
import type { AutomationStore } from './store.js';

/**
 * Turning a person's confirmation of an automation's exact computer scope into a grant (plan
 * §7.1). The shell's "Save and authorize" reads the details, shows them natively and approves the
 * `approvalHash` it showed; the `automation` tool confirms once with the same expanded scope and
 * mints the grant after the confirmation. Both recompute every hash inside the store change that
 * writes the grant, so content that moved on while the person looked is refused, and both need a
 * passed trial of exactly this content. No other path writes a grant.
 */

export interface ApprovalContext {
  computer: AutomationComputer;
  trials: ComputerTrials;
  lookups: Pick<Lookups, 'command'>;
}

/** The content an approval covers, with the trial that qualifies it (null: none matches). */
export interface Approval {
  definitionHash: string;
  recipeHash: string;
  bindingHashes: ComputerBindingHashes;
  engineProfilesHash: string | null;
  commandFingerprint?: string;
  trial: ComputerTrial | null;
  approvalHash: string;
}

type Candidate = Pick<AutomationDraft, 'trigger' | 'action' | 'policy'> & { id: string };

/** The fingerprint of the command a command action names; refuses one that is gone. */
export async function fingerprintOf(
  candidate: Pick<AutomationDraft, 'action'>,
  lookups: Pick<Lookups, 'command'>,
): Promise<string | undefined> {
  if (candidate.action.kind !== 'command') return undefined;
  const command = await lookups.command(candidate.action.commandId);
  if (!command) throw problemError('commandUnavailable', 'The command no longer exists.');
  return commandFingerprint(command);
}

/** The approval of `candidate` as it is now; `fingerprint` is its command's (`fingerprintOf`). */
export function approvalOf(
  candidate: Candidate,
  ctx: Omit<ApprovalContext, 'lookups'>,
  fingerprint: string | undefined,
): Approval {
  const policy = candidate.policy.computer;
  if (!policy) throw new TypeError('Invalid automation: it requests no computer scope.');
  const bindings = liveBindingHashes(policy, ctx.computer.bindings);
  if (!bindings) throw new TypeError('Invalid automation: a computer target is not registered.');
  const profiles = engineProfilesHash(policy, ctx.computer.bindings, ctx.computer.profiles());
  const scope = {
    automationId: candidate.id,
    definitionHash: definitionHash(candidate),
    recipeHash: recipeHash(policy.recipe),
    bindingHashes: bindings,
  };
  const trial = profiles ? ctx.trials.matching({ ...scope, engineProfilesHash: profiles }) : null;
  const approvalHash = sha256Of({
    ...scope,
    engineProfilesHash: profiles,
    commandFingerprint: fingerprint ?? null,
    trialId: trial?.trialId ?? null,
  });
  return {
    definitionHash: scope.definitionHash,
    recipeHash: scope.recipeHash,
    bindingHashes: bindings,
    engineProfilesHash: profiles,
    ...(fingerprint ? { commandFingerprint: fingerprint } : {}),
    trial,
    approvalHash,
  };
}

/** A new grant from a qualified approval; every approval gets a grant id of its own. */
export function grantFrom(approval: Approval, now: number): ComputerGrant {
  const { trial } = approval;
  if (!trial) throw new ConflictError('No passed trial matches this computer scope.');
  return {
    grantId: randomUUID(),
    version: 1,
    definitionHash: approval.definitionHash,
    recipeHash: approval.recipeHash,
    bindingHashes: approval.bindingHashes,
    ...(approval.commandFingerprint ? { commandFingerprint: approval.commandFingerprint } : {}),
    trialRef: {
      trialId: trial.trialId,
      at: trial.at,
      engineProfilesHash: trial.engineProfilesHash,
    },
    approvedAt: new Date(now).toISOString(),
  };
}

/**
 * The tool's mint, used inside the store change that saves the confirmed content: the grant when
 * a passed trial qualifies exactly what the person confirmed, none when no trial does, and a 409
 * when the content, a binding, the host's engines or the trial moved on since the confirmation.
 */
export function mintAfterConfirm(
  confirmed: Approval,
  ctx: Omit<ApprovalContext, 'lookups'>,
  fingerprint: string | undefined,
  now: number,
): (candidate: Automation) => ComputerGrant | undefined {
  return (candidate) => {
    const current = approvalOf(candidate, ctx, fingerprint);
    if (current.approvalHash !== confirmed.approvalHash)
      throw new ConflictError('The computer scope changed while you were confirming it.');
    return current.trial ? grantFrom(current, now) : undefined;
  };
}

function find(store: AutomationStore, id: string): Automation {
  const automation = store.data.definitions.automations.find((item) => item.id === id);
  if (!automation) throw new LedgerNotFound('Automation', id);
  return automation;
}

/** GET `/v1/admin/approvals/automation-computer/:id`: what the shell's confirmation shows. */
export async function approvalDetails(
  store: AutomationStore,
  ctx: ApprovalContext,
  id: string,
): Promise<AutomationComputerApprovalDetails> {
  const automation = find(store, id);
  const policy = automation.policy.computer;
  if (!policy) throw new TypeError('Invalid automation: it requests no computer scope.');
  const approval = approvalOf(automation, ctx, await fingerprintOf(automation, ctx.lookups));
  const bindings = policy.bindingIds
    .map((bindingId) => ctx.computer.bindings.get(bindingId))
    .filter((binding): binding is TargetBinding => binding !== undefined);
  return {
    automationId: automation.id,
    revision: automation.revision,
    name: automation.name,
    policy,
    bindings,
    definitionHash: approval.definitionHash,
    recipeHash: approval.recipeHash,
    ...(approval.commandFingerprint ? { commandFingerprint: approval.commandFingerprint } : {}),
    trial: approval.trial,
    approvalHash: approval.approvalHash,
  };
}

/**
 * POST `/v1/admin/approvals/automation-computer`: writes the grant for what the shell showed.
 * 409 `approval_changed` when the revision or the approval moved on; 409 `conflict` when no
 * passed trial qualifies the content (the shell reports it as not qualified).
 */
export async function approveComputer(
  store: AutomationStore,
  ctx: ApprovalContext,
  request: AutomationComputerApproveRequest,
  now: number,
): Promise<ComputerGrant> {
  const changed = () =>
    new ConflictError('The automation changed. Review it again.', 'approval_changed');
  const before = find(store, request.automationId);
  if (before.revision !== request.expectedRevision) throw changed();
  const fingerprint = await fingerprintOf(before, ctx.lookups);
  return store.change((data) => {
    const live = data.definitions.automations.find((item) => item.id === request.automationId);
    if (!live) throw new LedgerNotFound('Automation', request.automationId);
    if (live.revision !== request.expectedRevision) throw changed();
    const approval = approvalOf(live, ctx, fingerprint);
    if (approval.approvalHash !== request.approvalHash) throw changed();
    const grant = grantFrom(approval, now);
    live.computerGrant = grant;
    live.revision += 1;
    live.updatedAt = new Date(now).toISOString();
    return grant;
  });
}
