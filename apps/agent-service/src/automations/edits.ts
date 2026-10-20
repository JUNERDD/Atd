import { randomUUID } from 'node:crypto';
import {
  MAX_AUTOMATIONS,
  type Automation,
  type AutomationDraft,
  type MarkAutomationRunsReadRequest,
  type SetAutomationEnabledRequest,
  type UpdateAutomationRequest,
} from '@atd/agent-contracts';
import { ConflictError } from '../errors.js';
import { LedgerNotFound } from '../ledger.js';
import { checkDraft, computerAuthorized, problemError, type CheckContext } from './checks.js';
import type { AutomationComputer } from './computer-deps.js';
import { grantEnded, stopComputerWork, type GrantMint } from './computer-edits.js';
import { definitionHash } from './computer-grant.js';
import type { ComputerTrials } from './computer-trials.js';
import { startCursor } from './due.js';
import type { AutomationEngine } from './engine.js';
import { emptyAutomationState } from './files.js';
import { stateOf } from './records.js';
import type { AutomationData, AutomationStore } from './store.js';

/**
 * Every change a person or the agent makes to automations, for the routes and the `automation`
 * tool alike: validated in full before anything is written (`checks.ts`), revision-guarded, and
 * written together with the engine bookkeeping it implies (a fresh schedule cursor, a cleared
 * pause). A folder trigger saved, turned on or let go by the global pause takes its folder's
 * baseline before the change answers, so a file added right after it fires (folder-watch.ts).
 * A computer grant never survives an edit of what it approved, and a computer automation turns
 * on only with a grant that covers it as saved (computer-grant.ts); no plain edit mints one.
 */

export interface EditContext {
  store: AutomationStore;
  engine: AutomationEngine;
  check: () => CheckContext;
  now: () => number;
  /** Computer use; absent when the service runs without it. */
  computer?: AutomationComputer;
  trials?: ComputerTrials;
  /** Cancels a task run (the manager's `cancel`). */
  cancelRun: (taskId: string, runId: string) => Promise<unknown>;
}

function iso(time: number): string {
  return new Date(time).toISOString();
}

function find(data: AutomationData, id: string): Automation {
  const automation = data.definitions.automations.find((item) => item.id === id);
  if (!automation) throw new LedgerNotFound('Automation', id);
  return automation;
}

function refuseFull(count: number): void {
  if (count >= MAX_AUTOMATIONS)
    throw new TypeError(`Invalid automation: at most ${MAX_AUTOMATIONS} automations can be saved.`);
}

export async function createAutomation(
  ctx: EditContext,
  draft: AutomationDraft,
  createdBy: Automation['createdBy'],
): Promise<Automation> {
  refuseFull(ctx.store.data.definitions.automations.length);
  await checkDraft(draft, ctx.check(), undefined);
  // A new automation has no grant, and none can cite a trial before it exists.
  if (draft.enabled && draft.policy.computer) throw problemError('computerNeedsAuthorization');
  const now = ctx.now();
  const automation: Automation = {
    id: randomUUID(),
    revision: 1,
    ...draft,
    createdBy,
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  await ctx.store.change((data) => {
    refuseFull(data.definitions.automations.length);
    data.definitions.automations.push(automation);
    const state = emptyAutomationState();
    if (automation.enabled) startCursor(automation, state, now);
    data.state.automations[automation.id] = state;
  });
  if (automation.enabled) await ctx.engine.folderWatch.baseline(automation);
  return automation;
}

/**
 * Replaces a draft; 409 when `expectedRevision` is not the saved one. A computer grant whose
 * approved content changed is dropped, and `mint` (the tool's, after a confirmation) may grant
 * the saved content when a trial qualifies it; an enabled computer automation must end up covered.
 */
export async function updateAutomation(
  ctx: EditContext,
  id: string,
  request: UpdateAutomationRequest,
  mint?: GrantMint,
): Promise<Automation> {
  const current = find(ctx.store.data, id);
  if (current.revision !== request.expectedRevision)
    throw new ConflictError('This automation changed. Reload it before saving.');
  const check = ctx.check();
  await checkDraft(request.automation, check, id);
  const command = await commandOf(request.automation, check);
  const now = ctx.now();
  const triggerChanged =
    JSON.stringify(current.trigger) !== JSON.stringify(request.automation.trigger);
  const updated = await ctx.store.change((data) => {
    const live = find(data, id);
    if (live.revision !== request.expectedRevision)
      throw new ConflictError('This automation changed. Reload it before saving.');
    const next: Automation = {
      ...live,
      ...request.automation,
      revision: live.revision + 1,
      updatedAt: iso(now),
    };
    const approved = live.computerGrant?.definitionHash;
    if (!next.policy.computer || approved !== definitionHash(next)) delete next.computerGrant;
    covered(check, next, command, mint);
    data.definitions.automations = data.definitions.automations.map((item) =>
      item.id === id ? next : item,
    );
    const state = stateOf(data, id);
    const turnedOn = next.enabled && !live.enabled;
    if (turnedOn) clearPause(state);
    if (triggerChanged || turnedOn) startCursor(next, state, now);
    return next;
  });
  if (grantEnded(current, updated)) await stopComputerWork(ctx, id, 'revoked', false);
  if (triggerChanged) await ctx.engine.folderWatch.forget(id);
  if (updated.enabled && (triggerChanged || !current.enabled))
    await ctx.engine.folderWatch.baseline(updated);
  return updated;
}

/** The command a command action names, for the grant's fingerprint check. */
async function commandOf(draft: AutomationDraft, check: CheckContext) {
  return draft.action.kind === 'command' ? check.lookups.command(draft.action.commandId) : null;
}

/**
 * Inside the change that saves `next`: mints its grant when `mint` is given and its grant does
 * not cover it, then refuses an enabled computer automation its grant does not cover.
 */
function covered(
  check: CheckContext,
  next: Automation,
  command: Awaited<ReturnType<typeof commandOf>>,
  mint: GrantMint | undefined,
): void {
  if (!next.policy.computer) return;
  if (mint && !computerAuthorized(next, check, command)) {
    const grant = mint(next);
    if (grant) next.computerGrant = grant;
  }
  if (next.enabled && !computerAuthorized(next, check, command))
    throw problemError('computerNeedsAuthorization');
}

function clearPause(state: ReturnType<typeof stateOf>): void {
  delete state.pausedReason;
  state.consecutiveFailures = 0;
}

/**
 * The row switch. Turning an automation on checks it as a save would (a one-time run must still
 * lie ahead) and, for a computer automation, that its grant covers it (`mint`, the tool's after a
 * confirmation, may grant it then); it clears the service's pause and restarts its schedule from
 * now, and a folder trigger takes the folder as it is then. Turning a computer automation off
 * stops its runs in flight, so no further computer step starts.
 */
export async function setAutomationEnabled(
  ctx: EditContext,
  id: string,
  request: SetAutomationEnabledRequest,
  mint?: GrantMint,
): Promise<Automation> {
  const current = find(ctx.store.data, id);
  if (request.expectedRevision !== undefined && current.revision !== request.expectedRevision)
    throw new ConflictError('This automation changed. Reload it before switching it.');
  if (current.enabled === request.enabled) return current;
  const check = ctx.check();
  if (request.enabled) await checkDraft(current, check, id);
  const command = request.enabled ? await commandOf(current, check) : null;
  const now = ctx.now();
  const updated = await ctx.store.change((data) => {
    const live = find(data, id);
    const next: Automation = {
      ...live,
      enabled: request.enabled,
      revision: live.revision + 1,
      updatedAt: iso(now),
    };
    if (next.enabled) covered(check, next, command, mint);
    data.definitions.automations = data.definitions.automations.map((item) =>
      item.id === id ? next : item,
    );
    const state = stateOf(data, id);
    clearPause(state);
    if (next.enabled) startCursor(next, state, now);
    return next;
  });
  if (updated.enabled) await ctx.engine.folderWatch.baseline(updated);
  else if (updated.policy.computer) await stopComputerWork(ctx, id, 'revoked', true);
  return updated;
}

/** Deletes an automation with its history; a run of it still going is stopped. */
export async function deleteAutomation(
  ctx: EditContext,
  id: string,
  cancel: (taskId: string, runId: string) => Promise<unknown>,
): Promise<void> {
  find(ctx.store.data, id);
  ctx.engine.stopConsolidation(id);
  await stopComputerWork(ctx, id, 'revoked', false);
  const runs = ctx.store.data.state.automations[id]?.runs ?? [];
  for (const run of runs)
    if (run.outcome === 'running' && run.taskId && run.runId)
      await cancel(run.taskId, run.runId).catch(() => undefined);
  await ctx.store.change((data) => {
    find(data, id);
    data.definitions.automations = data.definitions.automations.filter((item) => item.id !== id);
    delete data.state.automations[id];
    data.state.notices = data.state.notices.filter((notice) => notice.automationId !== id);
  });
  await ctx.engine.folderWatch.forget(id);
  await ctx.trials?.forget(id);
}

/**
 * The global pause. Ending it gives every folder trigger that is on its folder as it is then:
 * nothing fires for what changed while everything was paused.
 */
export async function setPaused(ctx: EditContext, paused: boolean): Promise<void> {
  const was = ctx.store.data.definitions.paused;
  await ctx.store.change((data) => {
    data.definitions.paused = paused;
  });
  if (!was || paused) return;
  for (const automation of ctx.store.data.definitions.automations)
    if (automation.enabled) await ctx.engine.folderWatch.baseline(automation);
}

/** Marks finished runs read by run or by task; a request that changes nothing writes nothing. */
export async function markRunsRead(
  ctx: EditContext,
  request: MarkAutomationRunsReadRequest,
): Promise<void> {
  const runIds = new Set(request.runIds ?? []);
  const taskIds = new Set(request.taskIds ?? []);
  const matches = (run: { id: string; taskId?: string; outcome: string; readAt?: string }) =>
    run.outcome !== 'running' &&
    !run.readAt &&
    (runIds.has(run.id) || (run.taskId !== undefined && taskIds.has(run.taskId)));
  const states = Object.values(ctx.store.data.state.automations);
  if (!states.some((state) => state.runs.some(matches))) return;
  const now = iso(ctx.now());
  await ctx.store.change((data) => {
    for (const state of Object.values(data.state.automations))
      for (const run of state.runs) if (matches(run)) run.readAt = now;
  });
}

/** Drops the notices the shell posted; unknown ids are ignored. */
export async function ackNotices(ctx: EditContext, ids: readonly string[]): Promise<void> {
  const acked = new Set(ids);
  if (!ctx.store.data.state.notices.some((notice) => acked.has(notice.id))) return;
  await ctx.store.change((data) => {
    data.state.notices = data.state.notices.filter((notice) => !acked.has(notice.id));
  });
}
