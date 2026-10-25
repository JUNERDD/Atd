import type { Automation, AutomationDraft } from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { computerAuthorized, problemError } from './checks.js';
import { approvalOf, fingerprintOf, mintAfterConfirm, type Approval } from './computer-approval.js';
import { describeComputer } from './computer-describe.js';
import type { GrantMint } from './computer-edits.js';
import type { AutomationService } from './service.js';

/**
 * The `automation` tool's side of computer authorization (plan §3.3 step 4). The agent may propose
 * a computer scope but never authorize it: the one confirmation the tool asks for anyway shows the
 * expanded scope, and only after the person confirmed does the edit mint a grant, and only when a
 * passed trial qualifies exactly what was confirmed. Without one the automation is saved without
 * authorization and stays off; an edit that would leave it on uncovered is refused before asking.
 */

/** What a write shows in its confirmation, and the mint it applies once confirmed. */
export interface ComputerConfirmation {
  /** The scope in words; null for an automation without a computer scope. */
  scope: string | null;
  /** Recomputes after the confirmation; the grant mint the edit applies, if any. */
  confirmed: () => Promise<GrantMint | undefined>;
}

const NONE: ComputerConfirmation = { scope: null, confirmed: async () => undefined };

/**
 * Prepares the confirmation of saving `draft` over `existing` (null for a new automation, which
 * no trial can qualify yet).
 */
export async function computerConfirmation(
  service: AutomationService,
  draft: AutomationDraft,
  existing: Automation | null,
): Promise<ComputerConfirmation> {
  const policy = draft.policy.computer;
  if (!policy) return NONE;
  const check = service.checkContext();
  const context = service.approvals();
  const candidate = existing ? { ...existing, ...draft } : null;
  const { action } = draft;
  const command = action.kind === 'command' ? await check.lookups.command(action.commandId) : null;
  const covered = candidate !== null && computerAuthorized(candidate, check, command);
  const fingerprint = context ? await fingerprintOf(draft, context.lookups) : undefined;
  const approval: Approval | null =
    context && candidate ? approvalOf(candidate, context, fingerprint) : null;
  const trial = approval?.trial ?? null;
  if (draft.enabled && !covered && !trial) throw problemError('computerNeedsAuthorization');
  const scope = describeComputer(policy, context?.computer.bindings, covered, trial);
  return {
    scope,
    confirmed: async () => {
      if (!context || !approval || covered) return undefined;
      if ((await fingerprintOf(draft, context.lookups)) !== fingerprint)
        throw new ConflictError('The command changed while you were confirming.');
      return mintAfterConfirm(approval, context, fingerprint, service.checkContext().now);
    },
  };
}
