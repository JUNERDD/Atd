import {
  COMPUTER_MAX_STATUS_IDS,
  COMPUTER_ENGINE_FOR_KIND,
  type ComputerError,
  type ComputerFact,
  type HostReplyValue,
  type TargetBinding,
} from '@atd/agent-contracts';
import {
  auditComputer,
  envelopeFor,
  refuse,
  type CallContext,
  type CallBase,
  type ToolAnswer,
} from './call-context.js';
import type { HostOutcome } from './coordinator.js';
import { computerDetails } from './details.js';
import { readRunFacts } from './records.js';
import { settleFromJournal } from './reconcile.js';
import { refusalText } from './refusals.js';

const TARGETS_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 30_000;
const RELEASE_TIMEOUT_MS = 15_000;

/**
 * Why an operation that changes nothing got no value; such operations are safe to call again. A
 * host refusal names its code and reason and what to do about it (refusals.ts).
 */
export function outcomeProblem(outcome: HostOutcome): string {
  switch (outcome.kind) {
    case 'unsent':
      if (outcome.code === 'cancelled')
        return 'Computer use was stopped for this run; nothing was sent.';
      return outcome.message
        ? `${outcome.message}; nothing was sent.`
        : 'The computer host is not available; nothing was sent. Atd must be running on this Mac.';
    case 'lost':
      return `The computer host did not answer (${outcome.reason}).`;
    case 'reply':
      return outcome.reply.ok ? 'The computer host answered.' : refusalText(outcome.reply.error);
  }
}

/**
 * The structured error of an operation the host never answered, as transcript details carry it
 * (`ComputerDetails.error`): it was not sent, or its answer was lost.
 */
function outcomeError(outcome: Exclude<HostOutcome, { kind: 'reply' }>): ComputerError {
  const message = outcomeProblem(outcome);
  if (outcome.kind === 'unsent') return { code: outcome.code, message };
  const code = outcome.reason === 'disconnected' ? 'hostUnavailable' : outcome.reason;
  return { code, message };
}

/**
 * The value a host answered with, or a refusal naming why there is none, the binding the request
 * concerned (when one) and the operation's structured error.
 */
export function replyValue(
  ctx: CallBase,
  outcome: HostOutcome,
  op: string,
  bindingId?: string,
): HostReplyValue {
  const fields = { op, ...(bindingId ? { bindingId } : {}) };
  if (outcome.kind !== 'reply')
    return refuse(ctx, outcomeProblem(outcome), fields, outcomeError(outcome));
  if (!outcome.reply.ok) return refuse(ctx, outcomeProblem(outcome), fields, outcome.reply.error);
  return outcome.reply.value;
}

/** A reply of another kind than the operation's is a host bug; it is refused like no reply. */
export function wrongKind(ctx: CallBase, op: string, bindingId?: string): never {
  return refuse(ctx, 'The computer host answered with something else.', {
    op,
    ...(bindingId ? { bindingId } : {}),
  });
}

/** Resolves the run's bindings and retains the host's current refs for subsequent calls. */
export async function resolveTargets(ctx: CallContext) {
  const { bindings, coordinator } = ctx.runtime;
  const found: TargetBinding[] = [];
  const missing: { bindingId: string; reason: string }[] = [];
  for (const bindingId of ctx.computer.bindingIds) {
    const binding = bindings.get(bindingId);
    if (!binding) missing.push({ bindingId, reason: 'removed' });
    else if (!ctx.runtime.engineInstalled(COMPUTER_ENGINE_FOR_KIND[binding.kind]))
      missing.push({
        bindingId,
        reason:
          'engineNotInstalled: the person installs its engine in Settings → Computer use → Engines; then call targets again.',
      });
    else found.push(binding);
  }
  if (!found.length) return { targets: [], unavailable: missing };
  const outcome = await coordinator.request(
    envelopeFor(ctx, TARGETS_TIMEOUT_MS),
    { kind: 'targets', bindings: found },
    { signal: ctx.signal, timeoutMs: TARGETS_TIMEOUT_MS },
  );
  const value = replyValue(ctx, outcome, 'targets');
  if (value.kind !== 'targets') wrongKind(ctx, 'targets');
  const generation = coordinator.hostGeneration();
  // Only refs of the bindings asked for, at their current revision and host generation.
  const refs = value.refs.filter((ref) => {
    const binding = found.find((item) => item.bindingId === ref.bindingId);
    return binding?.revision === ref.bindingRevision && ref.hostGeneration === generation;
  });
  coordinator.rememberTargets(ctx.taskId, ctx.runId, refs);
  auditComputer(ctx, 'targets', { refs: refs.length, unavailable: value.unavailable.length });
  const label = (bindingId: string) => bindings.get(bindingId)?.label;
  return {
    targets: refs.map((ref) => {
      const binding = bindings.get(ref.bindingId);
      return {
        targetRefId: ref.id,
        bindingId: ref.bindingId,
        label: binding?.label,
        kind: binding?.kind,
        engine: ref.engine,
        ...(ref.capabilities ? { capabilities: ref.capabilities } : {}),
      };
    }),
    unavailable: [
      ...value.unavailable.map(({ bindingId, reason }) => ({
        bindingId,
        label: label(bindingId),
        reason,
      })),
      ...missing,
    ],
  };
}

/** `targets` and access approval expose the same structured target facts. */
export async function runTargets(ctx: CallContext): Promise<ToolAnswer> {
  return {
    text: JSON.stringify(await resolveTargets(ctx)),
    details: computerDetails({ op: 'targets' }),
  };
}

/** A fact as the model reads it. */
function factView(fact: ComputerFact): Record<string, unknown> {
  const { actionId, effect, phase, result, recipeStepId } = fact;
  return {
    actionId,
    effect,
    phase,
    ...(recipeStepId ? { recipeStepId } : {}),
    ...(result ? { result } : {}),
  };
}

/**
 * `status`: what happened to this run's actions (by default those still unresolved), asking the
 * host's journal for any without a result and recording what it settled.
 */
export async function runStatus(
  ctx: CallContext,
  actionIds?: readonly string[],
): Promise<ToolAnswer> {
  const facts = await readRunFacts(ctx.runtime.dataDir, ctx.runId);
  const wanted = actionIds
    ? facts.filter((fact) => actionIds.includes(fact.actionId))
    : facts.filter((fact) => !fact.result);
  const open = wanted.filter((fact) => !fact.result).slice(0, COMPUTER_MAX_STATUS_IDS);
  let settled: ComputerFact[] = [];
  if (open.length) {
    const outcome = await ctx.runtime.coordinator.request(
      envelopeFor(ctx, STATUS_TIMEOUT_MS),
      { kind: 'status', actionIds: open.map((fact) => fact.actionId) },
      { signal: ctx.signal, timeoutMs: STATUS_TIMEOUT_MS },
    );
    if (outcome.kind === 'reply' && outcome.reply.ok && outcome.reply.value.kind === 'status')
      settled = await settleFromJournal(ctx.runtime.records, outcome.reply.value.records);
    else ctx.log.debug('Computer status went unanswered.', { runId: ctx.runId });
  }
  const latest = wanted.map(
    (fact) => settled.find((item) => item.actionId === fact.actionId) ?? fact,
  );
  const unknownIds = (actionIds ?? []).filter((id) => !facts.some((fact) => fact.actionId === id));
  auditComputer(ctx, 'status', { asked: open.length, settled: settled.length });
  return {
    text: JSON.stringify({
      actions: latest.map(factView),
      ...(unknownIds.length ? { notActionsOfThisRun: unknownIds } : {}),
    }),
    details: computerDetails({ op: 'status' }),
  };
}

/** `release`: lets the host free a target this run no longer needs. */
export async function runRelease(ctx: CallContext, targetRefId: string): Promise<ToolAnswer> {
  const { coordinator, bindings } = ctx.runtime;
  const targetRef = coordinator.target(ctx.runId, targetRefId);
  if (!targetRef) refuse(ctx, 'Unknown or outdated targetRefId; nothing to release.');
  const outcome = await coordinator.request(
    envelopeFor(ctx, RELEASE_TIMEOUT_MS),
    { kind: 'release', targetRef },
    { signal: ctx.signal, timeoutMs: RELEASE_TIMEOUT_MS },
  );
  const { bindingId } = targetRef;
  if (replyValue(ctx, outcome, 'release', bindingId).kind !== 'released')
    wrongKind(ctx, 'release', bindingId);
  coordinator.forgetTarget(targetRefId);
  auditComputer(ctx, 'release', { bindingId: targetRef.bindingId });
  return {
    text: JSON.stringify({ released: targetRefId }),
    details: computerDetails({
      op: 'release',
      target: bindings.get(bindingId)?.label,
      bindingId,
    }),
  };
}
