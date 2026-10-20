import type {
  Automation,
  ComputerCancelReason,
  ComputerGrant,
  ResolveComputerHoldRequest,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { revokeForBinding } from './computer-grant.js';
import type { EditContext } from './edits.js';

/**
 * The computer side of automation edits: stopping a computer automation's work in flight when it
 * is turned off, deleted or loses its grant, revoking grants a binding change voided, and the one
 * explicit way to clear a hold. Reading results, editing the automation or Run now never clear it.
 */

/**
 * Mints a grant for the automation as a confirmed edit is about to save it (computer-approval.ts
 * `mintAfterConfirm`); undefined when no passed trial qualifies it. Only the `automation` tool
 * passes one, after the person's confirmation; routes never do.
 */
export type GrantMint = (candidate: Automation) => ComputerGrant | undefined;

/**
 * Closes the computer work of the automation's runs that have not ended: no new step starts.
 * `stopRuns` also cancels the task runs themselves (the automation was turned off or deleted).
 */
export async function stopComputerWork(
  ctx: EditContext,
  automationId: string,
  reason: ComputerCancelReason,
  stopRuns: boolean,
): Promise<void> {
  const runs = ctx.store.data.state.automations[automationId]?.runs ?? [];
  for (const run of runs) {
    if (run.outcome !== 'running' || !run.taskId || !run.runId) continue;
    await Promise.resolve(ctx.computer?.cancelRun(run.taskId, run.runId, reason)).catch(
      () => undefined,
    );
    if (stopRuns) await ctx.cancelRun(run.taskId, run.runId).catch(() => undefined);
  }
}

/** Whether saving `next` over `previous` ends the grant `previous` had. */
export function grantEnded(previous: Automation, next: Automation): boolean {
  return previous.computerGrant !== undefined && next.computerGrant !== previous.computerGrant;
}

/**
 * Revokes every grant the change of binding `bindingId` voided (its content hash moved on, or it
 * was deleted) and stops those automations' computer work. Answers the automations revoked.
 */
export async function invalidateBinding(ctx: EditContext, bindingId: string): Promise<string[]> {
  const bindings = ctx.computer?.bindings;
  if (!bindings) return [];
  const now = new Date(ctx.now()).toISOString();
  const revoked = await ctx.store.change((data) =>
    revokeForBinding(data.definitions.automations, bindingId, bindings, now),
  );
  // Not awaited: the binding store waits on this listener, and stopping a host action may take
  // its bounded convergence; the revocation already stops every next step.
  for (const id of revoked) void stopComputerWork(ctx, id, 'revoked', false).catch(() => undefined);
  return revoked;
}

/**
 * POST `/v1/automations/:id/computer-hold/resolve`: a person reviewed the run that set the hold.
 * 409 when no hold stands or it was set by another run.
 */
export async function resolveHold(
  ctx: EditContext,
  id: string,
  request: ResolveComputerHoldRequest,
): Promise<void> {
  await ctx.store.change((data) => {
    if (!data.definitions.automations.some((item) => item.id === id))
      throw new LedgerNotFound('Automation', id);
    const state = data.state.automations[id];
    if (!state?.computerHold) throw new ConflictError('No computer hold stands on it.');
    if (state.computerHold.runId !== request.runId)
      throw new ConflictError('Another run set the hold. Reload it, then review that run.');
    delete state.computerHold;
  });
}
